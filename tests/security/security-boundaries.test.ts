import { describe, expect, it } from "vitest";
import { EncryptedCredentialStore } from "../../src/auth/encrypted-credential-store";
import { MemoryCredentialBackend } from "../../src/auth/credential-store";
import { validateOAuthState } from "../../src/auth/oauth-pkce";
import { GOOGLE_SCOPES } from "../../src/auth/oauth-pkce";
import { exportPairingBundle, importPairingBundle } from "../../src/auth/pairing";
import type { GoogleDriveClient } from "../../src/drive/drive-client";
import { VaultDriveClient, type VaultCapabilityState } from "../../src/drive/vault-drive-client";
import type { DriveFile } from "../../src/drive/drive-types";
import { VaultScanner, type VaultAdapter } from "../../src/local/vault-scanner";
import { assertValidDriveFileId } from "../../src/local/path-validator";
import { redact } from "../../src/logging/redaction";
import { validateManifest } from "../../src/manifest/manifest-schema";
import { isEligibleForPurge } from "../../src/recovery/tombstones";
import { DEFAULT_SETTINGS } from "../../src/storage/settings-store";
import type { VaultIdentity } from "../../src/types/domain";
import { HASH_A, VAULT_ID, entry, manifest, tombstone } from "../fixtures/builders";

const vault: VaultIdentity = {
  vaultId: VAULT_ID,
  shortVaultId: "vaultshort",
  displayName: "Vault",
  rootFolderId: "root_folder_12345",
  recoveryFolderId: "recovery_folder_12345",
  manifestFileId: "manifest_file_12345",
  createdAt: "2026-07-21T10:00:00.000Z",
  schemaVersion: 1,
};

describe("security boundaries", () => {
  it("does not log tokens or authorization headers", () => {
    const output = JSON.stringify(
      redact({ Authorization: "Bearer supersecret", refreshToken: "refreshsecret" }),
    );
    expect(output).not.toContain("supersecret");
    expect(output).not.toContain("refreshsecret");
  });

  it("does not store a plaintext credential", async () => {
    const backend = new MemoryCredentialBackend();
    const store = new EncryptedCredentialStore(backend, 100_000);
    await store.unlock("a sufficiently long passphrase");
    await store.save({
      clientId: "client.apps.googleusercontent.com",
      refreshToken: "raw-refresh-token",
      scopes: [...GOOGLE_SCOPES],
    });
    expect(backend.value).not.toContain("raw-refresh-token");
  });

  it("rejects OAuth state mismatch", () => {
    expect(validateOAuthState("expected", "attacker")).toBe(false);
  });

  it("rejects path-shaped Drive IDs", () => {
    expect(() => assertValidDriveFileId("../../outside")).toThrow("invalid Google Drive file ID");
  });

  it("refuses to update a file outside the manifest allowlist", async () => {
    let requests = 0;
    const fake = {
      getFile: async () => {
        requests += 1;
        throw new Error("must not be called");
      },
    } as unknown as GoogleDriveClient;
    const state: VaultCapabilityState = { entries: {}, tombstones: {}, pendingDriveIds: new Set() };
    const client = new VaultDriveClient(fake, vault, () => state);
    await expect(
      client.updateVaultFile("note001", "outside_file_12345", {
        mimeType: "text/plain",
        content: new Uint8Array(),
      }),
    ).rejects.toThrow("not in the active manifest");
    expect(requests).toBe(0);
  });

  it("refuses a file with the wrong vault app property", async () => {
    const tracked = entry("note001", "Note.md", HASH_A, { driveFileId: "tracked_file_12345" });
    const wrong: DriveFile = {
      id: tracked.driveFileId,
      name: "Note.md",
      mimeType: "text/markdown",
      parents: [vault.rootFolderId],
      appProperties: { vaultId: "wrongvault", logicalId: "note001", objectType: "file" },
    };
    const fake = { getFile: async () => ({ file: wrong }) } as unknown as GoogleDriveClient;
    const state: VaultCapabilityState = {
      entries: { note001: tracked },
      tombstones: {},
      pendingDriveIds: new Set(),
    };
    const client = new VaultDriveClient(fake, vault, () => state);
    await expect(
      client.updateVaultFile("note001", tracked.driveFileId, {
        mimeType: "text/plain",
        content: new Uint8Array(),
      }),
    ).rejects.toThrow("wrong vault ID");
  });

  it("a corrupt manifest cannot be planned into deletion", () => {
    const corrupt = manifest(1, [entry("note001", "../outside")]);
    expect(() => validateManifest(corrupt)).toThrow();
  });

  it("enforces recovery retention", () => {
    const item = tombstone("note001", "Note.md");
    expect(isEligibleForPurge(item, Date.parse("2026-08-01T00:00:00Z"))).toBe(false);
    expect(isEligibleForPurge(item, Date.parse("2026-09-01T00:00:00Z"))).toBe(true);
  });

  it("always excludes the plugin credential directory", async () => {
    const reads: string[] = [];
    const adapter: VaultAdapter = {
      list: async (path) => {
        if (path === "") return { files: [], folders: [".obsidian"] };
        if (path === ".obsidian") return { files: [], folders: [".obsidian/plugins"] };
        if (path === ".obsidian/plugins")
          return { files: [], folders: [".obsidian/plugins/vaultbridge-drive"] };
        if (path === ".obsidian/plugins/vaultbridge-drive") {
          return { files: [".obsidian/plugins/vaultbridge-drive/data.json"], folders: [] };
        }
        return { files: [], folders: [] };
      },
      stat: async () => ({ type: "file", ctime: 0, mtime: 0, size: 10 }),
      readBinary: async (path) => {
        reads.push(path);
        return new ArrayBuffer(0);
      },
    };
    const settings = {
      ...DEFAULT_SETTINGS,
      includeHiddenFiles: true,
      includeObsidianConfig: true,
      includeCommunityPlugins: true,
      includePluginSettings: true,
      exclusions: [],
    };
    const scan = await new VaultScanner(adapter, settings, {}).scan();
    expect(scan.snapshot.entries[".obsidian/plugins/vaultbridge-drive/data.json"]).toBeUndefined();
    expect(reads).toHaveLength(0);
  });

  it("rejects expired and wrong-key pairing bundles", async () => {
    const exported = await exportPairingBundle(
      {
        clientId: "client.apps.googleusercontent.com",
        refreshToken: "refresh",
        scopes: [...GOOGLE_SCOPES],
      },
      [vault],
      60_000,
      1_700_000_000_000,
    );
    await expect(
      importPairingBundle(exported.encryptedBundle, exported.pairingSecret, 1_700_000_100_000),
    ).rejects.toThrow();
    await expect(importPairingBundle(exported.encryptedBundle, "x".repeat(43))).rejects.toThrow();
  });
});
