import { describe, expect, it } from "vitest";
import { exportPairingBundle, importPairingBundle } from "../../src/auth/pairing";
import { GOOGLE_SCOPES } from "../../src/auth/oauth-pkce";
import type { OAuthCredentials, VaultIdentity } from "../../src/types/domain";
import { VAULT_ID } from "../fixtures/builders";

const credentials: OAuthCredentials = {
  clientId: "client.apps.googleusercontent.com",
  clientSecret: "desktop-secret-placeholder",
  refreshToken: "never-display-this-refresh-token",
  scopes: [...GOOGLE_SCOPES],
};
const vault: VaultIdentity = {
  vaultId: VAULT_ID,
  shortVaultId: "shortId1",
  displayName: "Test Vault",
  rootFolderId: "root_drive_12345",
  recoveryFolderId: "recovery_drive_12345",
  manifestFileId: "manifest_drive_12345",
  createdAt: "2026-07-21T10:00:00.000Z",
  schemaVersion: 1,
};

describe("mobile pairing", () => {
  it("round-trips an encrypted transfer", async () => {
    const exported = await exportPairingBundle(credentials, [vault], 600_000, 1_700_000_000_000);
    expect(exported.encryptedBundle).not.toContain(credentials.refreshToken);
    expect(exported.encryptedBundle).not.toContain(credentials.clientSecret);
    const imported = await importPairingBundle(
      exported.encryptedBundle,
      exported.pairingSecret,
      1_700_000_100_000,
    );
    expect(imported.credentials.refreshToken).toBe(credentials.refreshToken);
    expect(imported.credentials.clientSecret).toBe(credentials.clientSecret);
    expect(imported.vaults).toEqual([vault]);
  });

  it("rejects the wrong secret", async () => {
    const exported = await exportPairingBundle(credentials, [vault]);
    const other = await exportPairingBundle(credentials, [vault]);
    await expect(
      importPairingBundle(exported.encryptedBundle, other.pairingSecret),
    ).rejects.toThrow();
  });

  it("rejects expiration", async () => {
    const exported = await exportPairingBundle(credentials, [vault], 60_000, 1_700_000_000_000);
    await expect(
      importPairingBundle(exported.encryptedBundle, exported.pairingSecret, 1_700_000_061_000),
    ).rejects.toThrow("expired");
  });

  it("rejects an excessive lifetime", async () => {
    await expect(exportPairingBundle(credentials, [vault], 61 * 60_000)).rejects.toThrow(
      "1-60 minutes",
    );
  });
});
