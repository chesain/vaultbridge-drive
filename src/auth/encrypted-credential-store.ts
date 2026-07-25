import type { OAuthCredentials } from "../types/domain";
import { SyncError } from "../types/sync-errors";
import { randomBytes } from "../utils/crypto";
import { canonicalJson } from "../utils/canonical-json";
import { fromBase64Url, fromUtf8, toBase64Url, utf8 } from "../utils/encoding";
import type { CredentialEnvelopeBackend, CredentialStore } from "./credential-store";
import { oauthCredentialsSchema } from "./credential-schema";
import { z } from "zod";

const FORMAT = "vaultbridge-credentials";
export const DEFAULT_PBKDF2_ITERATIONS = 310_000;

const envelopeSchema = z
  .object({
    format: z.literal(FORMAT),
    version: z.literal(1),
    kdf: z.literal("PBKDF2-SHA-256"),
    iterations: z.number().int().min(100_000).max(10_000_000),
    salt: z.string().min(16).max(128),
    iv: z.string().min(12).max(64),
    ciphertext: z.string().min(16).max(32_768),
  })
  .strict();

type CredentialEnvelope = z.infer<typeof envelopeSchema>;

export class EncryptedCredentialStore implements CredentialStore {
  private key: CryptoKey | null = null;
  private salt: Uint8Array<ArrayBuffer> | null = null;
  private activeIterations: number;
  private credentials: OAuthCredentials | null = null;
  private newPassphrase: string | null = null;

  constructor(
    private readonly backend: CredentialEnvelopeBackend,
    private readonly iterations = DEFAULT_PBKDF2_ITERATIONS,
  ) {
    this.activeIterations = iterations;
  }

  async isAvailable(): Promise<boolean> {
    return typeof crypto?.subtle !== "undefined";
  }

  async hasCredentials(): Promise<boolean> {
    return (await this.backend.read()) !== null;
  }

  async unlock(passphrase: string): Promise<boolean> {
    this.validatePassphrase(passphrase);
    const raw = await this.backend.read();
    if (raw === null) {
      this.newPassphrase = passphrase;
      this.credentials = null;
      this.key = null;
      this.salt = null;
      this.activeIterations = this.iterations;
      return true;
    }
    try {
      const envelope = envelopeSchema.parse(JSON.parse(raw) as unknown);
      const key = await deriveKey(passphrase, fromBase64Url(envelope.salt), envelope.iterations);
      const plaintext = await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: fromBase64Url(envelope.iv),
          additionalData: envelopeAad(envelope),
          tagLength: 128,
        },
        key,
        fromBase64Url(envelope.ciphertext),
      );
      this.credentials = oauthCredentialsSchema.parse(JSON.parse(fromUtf8(plaintext)) as unknown);
      this.key = key;
      this.salt = fromBase64Url(envelope.salt);
      this.activeIterations = envelope.iterations;
      this.newPassphrase = null;
      return true;
    } catch {
      this.credentials = null;
      this.key = null;
      this.salt = null;
      this.newPassphrase = null;
      return false;
    }
  }

  async save(credentials: OAuthCredentials): Promise<void> {
    const validated = oauthCredentialsSchema.parse(credentials);
    let salt = this.salt ?? randomBytes(16);
    const iv = randomBytes(12);
    let key = this.key;
    let iterations = this.activeIterations;
    if (this.newPassphrase !== null) {
      salt = randomBytes(16);
      iterations = this.iterations;
      key = await deriveKey(this.newPassphrase, salt, iterations);
    }
    if (key === null) throw lockedError();
    const partial: Omit<CredentialEnvelope, "ciphertext"> = {
      format: FORMAT,
      version: 1,
      kdf: "PBKDF2-SHA-256",
      iterations,
      salt: toBase64Url(salt),
      iv: toBase64Url(iv),
    };
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: envelopeAad(partial), tagLength: 128 },
      key,
      utf8(canonicalJson(validated)),
    );
    await this.backend.write(
      JSON.stringify({ ...partial, ciphertext: toBase64Url(new Uint8Array(ciphertext)) }),
    );
    this.credentials = structuredClone(validated);
    this.key = key;
    this.salt = salt;
    this.activeIterations = iterations;
    this.newPassphrase = null;
  }

  async load(): Promise<OAuthCredentials | null> {
    if ((await this.hasCredentials()) && this.key === null) throw lockedError();
    return this.credentials === null ? null : structuredClone(this.credentials);
  }

  async clear(): Promise<void> {
    await this.backend.remove();
    await this.lock();
  }

  async lock(): Promise<void> {
    this.key = null;
    this.salt = null;
    this.activeIterations = this.iterations;
    this.credentials = null;
    this.newPassphrase = null;
  }

  async changePassphrase(newPassphrase: string): Promise<void> {
    this.validatePassphrase(newPassphrase);
    if (this.key === null || this.credentials === null) throw lockedError();
    const credentials = structuredClone(this.credentials);
    this.key = null;
    this.salt = null;
    this.activeIterations = this.iterations;
    this.newPassphrase = newPassphrase;
    await this.save(credentials);
  }

  private validatePassphrase(passphrase: string): void {
    if (passphrase.length < 12 || passphrase.length > 1024) {
      throw new SyncError("CREDENTIAL_STORE_LOCKED", "Passphrase must be 12-1024 characters", {
        retrySafe: true,
        userActionRequired: true,
        resumable: false,
        dataAtRisk: false,
      });
    }
  }
}

async function deriveKey(
  passphrase: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey("raw", utf8(passphrase), "PBKDF2", false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function envelopeAad(envelope: Omit<CredentialEnvelope, "ciphertext">): Uint8Array<ArrayBuffer> {
  return utf8(
    canonicalJson({
      format: envelope.format,
      version: envelope.version,
      kdf: envelope.kdf,
      iterations: envelope.iterations,
      salt: envelope.salt,
      iv: envelope.iv,
    }),
  );
}

function lockedError(): SyncError {
  return new SyncError("CREDENTIAL_STORE_LOCKED", "Credential store is locked", {
    retrySafe: true,
    userActionRequired: true,
    resumable: true,
    dataAtRisk: false,
  });
}
