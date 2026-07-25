import { z } from "zod";
import type { OAuthCredentials, VaultIdentity } from "../types/domain";
import { SyncError } from "../types/sync-errors";
import { randomBytes, randomId } from "../utils/crypto";
import { canonicalJson } from "../utils/canonical-json";
import { fromBase64Url, fromUtf8, toBase64Url, utf8 } from "../utils/encoding";
import { assertMinimumGoogleScopes } from "./oauth-pkce";

const PAIRING_FORMAT = "vaultbridge-pairing";
const pairingPayloadSchema = z
  .object({
    version: z.literal(1),
    createdAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
    nonce: z.string().min(16).max(128),
    clientId: z.string().min(10).max(300),
    clientSecret: z.string().min(1).max(1024).optional(),
    refreshToken: z.string().min(4).max(4096),
    scopes: z.array(z.string().url()).min(1).max(10),
    accountEmail: z.string().email().max(320).optional(),
    accountDisplayName: z.string().min(1).max(500).optional(),
    vaults: z.array(
      z
        .object({
          vaultId: z.string().uuid(),
          shortVaultId: z.string().min(6).max(32),
          displayName: z.string().min(1).max(200),
          rootFolderId: z.string().min(10).max(200),
          recoveryFolderId: z.string().min(10).max(200),
          manifestFileId: z.string().min(10).max(200),
          createdAt: z.string().datetime(),
          schemaVersion: z.number().int().positive(),
        })
        .strict(),
    ),
  })
  .strict();

const pairingEnvelopeSchema = z
  .object({
    format: z.literal(PAIRING_FORMAT),
    version: z.literal(1),
    iv: z.string().min(12).max(64),
    ciphertext: z.string().min(16).max(131_072),
  })
  .strict();

export interface PairingExport {
  encryptedBundle: string;
  pairingSecret: string;
  expiresAt: string;
}

export interface PairingImport {
  credentials: OAuthCredentials;
  vaults: VaultIdentity[];
}

export async function exportPairingBundle(
  credentials: OAuthCredentials,
  vaults: VaultIdentity[],
  ttlMs = 10 * 60_000,
  now = Date.now(),
): Promise<PairingExport> {
  if (ttlMs < 60_000 || ttlMs > 60 * 60_000)
    throw new RangeError("Pairing expiry must be 1-60 minutes");
  const secret = randomBytes(32);
  const iv = randomBytes(12);
  const createdAt = new Date(now).toISOString();
  const expiresAt = new Date(now + ttlMs).toISOString();
  const payload = pairingPayloadSchema.parse({
    version: 1,
    createdAt,
    expiresAt,
    nonce: randomId(18),
    clientId: credentials.clientId,
    clientSecret: credentials.clientSecret,
    refreshToken: credentials.refreshToken,
    scopes: credentials.scopes,
    accountEmail: credentials.accountEmail,
    accountDisplayName: credentials.accountDisplayName,
    vaults,
  });
  assertMinimumGoogleScopes(payload.scopes);
  const key = await crypto.subtle.importKey("raw", secret, { name: "AES-GCM" }, false, ["encrypt"]);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: utf8(`${PAIRING_FORMAT}:1`), tagLength: 128 },
    key,
    utf8(canonicalJson(payload)),
  );
  return {
    encryptedBundle: JSON.stringify({
      format: PAIRING_FORMAT,
      version: 1,
      iv: toBase64Url(iv),
      ciphertext: toBase64Url(new Uint8Array(ciphertext)),
    }),
    pairingSecret: toBase64Url(secret),
    expiresAt,
  };
}

export async function importPairingBundle(
  encryptedBundle: string,
  pairingSecret: string,
  now = Date.now(),
): Promise<PairingImport> {
  try {
    if (encryptedBundle.length > 180_000) throw new Error("Pairing bundle is too large");
    const envelope = pairingEnvelopeSchema.parse(JSON.parse(encryptedBundle) as unknown);
    const secret = fromBase64Url(pairingSecret);
    if (secret.byteLength !== 32) throw new Error("Invalid pairing secret");
    const key = await crypto.subtle.importKey("raw", secret, { name: "AES-GCM" }, false, [
      "decrypt",
    ]);
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: fromBase64Url(envelope.iv),
        additionalData: utf8(`${PAIRING_FORMAT}:1`),
        tagLength: 128,
      },
      key,
      fromBase64Url(envelope.ciphertext),
    );
    const payload = pairingPayloadSchema.parse(JSON.parse(fromUtf8(plaintext)) as unknown);
    assertMinimumGoogleScopes(payload.scopes);
    if (Date.parse(payload.expiresAt) < now || Date.parse(payload.createdAt) > now + 60_000) {
      throw new SyncError("AUTH_REQUIRED", "Pairing bundle has expired or is not yet valid", {
        retrySafe: false,
        userActionRequired: true,
        resumable: false,
        dataAtRisk: false,
      });
    }
    return {
      credentials: {
        clientId: payload.clientId,
        clientSecret: payload.clientSecret,
        refreshToken: payload.refreshToken,
        scopes: payload.scopes,
        accountEmail: payload.accountEmail,
        accountDisplayName: payload.accountDisplayName,
      },
      vaults: payload.vaults,
    };
  } catch (error) {
    if (error instanceof SyncError) throw error;
    throw new SyncError("AUTH_REQUIRED", "Pairing bundle could not be decrypted or validated", {
      retrySafe: false,
      userActionRequired: true,
      resumable: false,
      dataAtRisk: false,
      cause: error,
    });
  }
}
