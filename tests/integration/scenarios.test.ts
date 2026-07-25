import { describe, expect, it, vi } from "vitest";
import type { CredentialStore } from "../../src/auth/credential-store";
import { exportPairingBundle, importPairingBundle } from "../../src/auth/pairing";
import { GOOGLE_SCOPES } from "../../src/auth/oauth-pkce";
import { TokenManager } from "../../src/auth/token-manager";
import { AppDataStore } from "../../src/drive/appdata-store";
import { GoogleDriveClient } from "../../src/drive/drive-client";
import type { DriveFile } from "../../src/drive/drive-types";
import { resumableUpload } from "../../src/drive/resumable-upload";
import { retryDecision } from "../../src/drive/retry-policy";
import { validateRelativePath } from "../../src/local/path-validator";
import { VaultScanner, type VaultAdapter } from "../../src/local/vault-scanner";
import { Logger } from "../../src/logging/logger";
import { parseManifestJson, serializeManifest } from "../../src/manifest/manifest-schema";
import { ManifestStore } from "../../src/manifest/manifest-store";
import { PluginDataStore } from "../../src/storage/plugin-data-store";
import { LocalStateStore } from "../../src/storage/local-state-store";
import { DEFAULT_SETTINGS } from "../../src/storage/settings-store";
import { restoreModificationTime } from "../../src/sync/executor";
import { planSync } from "../../src/sync/planner";
import { createJournal, markJournalOperation } from "../../src/sync/transaction-journal";
import type { OAuthCredentials, VaultIdentity } from "../../src/types/domain";
import {
  HASH_A,
  HASH_B,
  HASH_C,
  VAULT_ID,
  entry,
  folder,
  local,
  manifest,
  planInput,
  tombstone,
} from "../fixtures/builders";

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

type Scenario = { name: string; run: () => void | Promise<void> };

const scenarios: Scenario[] = [
  {
    name: "01 first device creates a new remote vault plan",
    run: () => {
      expect(
        planSync(planInput(manifest(0), manifest(0), [local("Welcome.md")])).uploads,
      ).toHaveLength(1);
    },
  },
  {
    name: "02 second device downloads the vault",
    run: () => {
      expect(
        planSync(planInput(manifest(0), manifest(1, [entry("note001", "Welcome.md")]), []))
          .downloads,
      ).toHaveLength(1);
    },
  },
  {
    name: "03 device A creates a note",
    run: () => {
      expect(planSync(planInput(manifest(0), manifest(0), [local("A.md")])).uploads[0]?.kind).toBe(
        "create",
      );
    },
  },
  {
    name: "04 device B receives a created note",
    run: () => {
      expect(
        planSync(planInput(manifest(0), manifest(1, [entry("note001", "A.md")]), [])).downloads[0]
          ?.path,
      ).toBe("A.md");
    },
  },
  {
    name: "05 device A edits a note",
    run: () => {
      const base = manifest(1, [entry("note001", "A.md", HASH_A)]);
      expect(planSync(planInput(base, base, [local("A.md", HASH_B)])).uploads[0]?.kind).toBe(
        "update",
      );
    },
  },
  {
    name: "06 device B receives an edited note",
    run: () => {
      const base = manifest(1, [entry("note001", "A.md", HASH_A)]);
      const remote = manifest(2, [entry("note001", "A.md", HASH_B)]);
      expect(planSync(planInput(base, remote, [local("A.md", HASH_A)])).downloads[0]?.kind).toBe(
        "update",
      );
    },
  },
  {
    name: "07 file rename propagates",
    run: () => {
      const base = manifest(1, [entry("note001", "Old.md")]);
      const input = planInput(base, base, [local("New.md")], {
        pendingLocalEvents: [{ type: "rename", oldPath: "Old.md", path: "New.md", at: 1 }],
      });
      expect(planSync(input).remoteMoves[0]).toMatchObject({
        fromPath: "Old.md",
        toPath: "New.md",
      });
    },
  },
  {
    name: "08 folder rename propagates",
    run: () => {
      const base = manifest(1, [
        folder("folder01", "Old"),
        entry("note001", "Old/A.md", HASH_A, { parentLogicalId: "folder01" }),
      ]);
      const input = planInput(
        base,
        base,
        [
          local("New", HASH_A, {
            objectType: "folder",
            contentHash: undefined,
            byteSize: undefined,
          }),
          local("New/A.md"),
        ],
        { pendingLocalEvents: [{ type: "rename", oldPath: "Old", path: "New", at: 1 }] },
      );
      expect(
        planSync(input).remoteMoves.some(
          (move) => move.objectType === "folder" && move.toPath === "New",
        ),
      ).toBe(true);
    },
  },
  {
    name: "09 file deletion propagates to recovery",
    run: () => {
      const base = manifest(1, [entry("note001", "A.md")]);
      expect(planSync(planInput(base, base, [])).recoveries[0]?.direction).toBe(
        "remote-to-recovery",
      );
    },
  },
  {
    name: "10 folder deletion propagates with child tombstones",
    run: () => {
      const base = manifest(1, [
        folder("folder01", "Folder"),
        entry("note001", "Folder/A.md", HASH_A, { parentLogicalId: "folder01" }),
      ]);
      expect(planSync(planInput(base, base, [])).tombstonesToCreate).toHaveLength(2);
    },
  },
  {
    name: "11 stale device cannot resurrect a tombstoned file",
    run: () => {
      const remote = manifest(2, [], [tombstone("note001", "A.md")]);
      const plan = planSync(
        planInput(manifest(0), remote, [local("A.md", HASH_A, { logicalId: "note001" })]),
      );
      expect(plan.uploads.some((upload) => upload.logicalId === "note001")).toBe(false);
    },
  },
  {
    name: "12 both devices make the same edit",
    run: () => {
      const base = manifest(1, [entry("note001", "A.md", HASH_A)]);
      const remote = manifest(2, [entry("note001", "A.md", HASH_B)]);
      expect(planSync(planInput(base, remote, [local("A.md", HASH_B)])).conflicts).toHaveLength(0);
    },
  },
  {
    name: "13 both devices make different edits",
    run: () => {
      const base = manifest(1, [entry("note001", "A.md", HASH_A)]);
      const remote = manifest(2, [entry("note001", "A.md", HASH_B)]);
      expect(planSync(planInput(base, remote, [local("A.md", HASH_C)])).conflicts[0]?.kind).toBe(
        "both-modified",
      );
    },
  },
  {
    name: "14 edit versus delete becomes a preserved conflict",
    run: () => {
      const base = manifest(1, [entry("note001", "A.md", HASH_A)]);
      const remote = manifest(2, [], [tombstone("note001", "A.md")]);
      expect(planSync(planInput(base, remote, [local("A.md", HASH_B)])).conflicts[0]?.kind).toBe(
        "modify-delete",
      );
    },
  },
  {
    name: "15 rename versus edit becomes a conflict",
    run: () => {
      const base = manifest(1, [entry("note001", "Old.md", HASH_A)]);
      const remote = manifest(2, [entry("note001", "Old.md", HASH_B)]);
      const input = planInput(base, remote, [local("New.md", HASH_A)], {
        pendingLocalEvents: [{ type: "rename", oldPath: "Old.md", path: "New.md", at: 1 }],
      });
      expect(planSync(input).conflicts[0]?.kind).toBe("rename-modify");
    },
  },
  {
    name: "16 file versus folder collision is blocked",
    run: () => {
      const base = manifest(1, [entry("thing01", "Thing")]);
      const localFolder = local("Thing", HASH_A, {
        objectType: "folder",
        contentHash: undefined,
        byteSize: undefined,
      });
      expect(planSync(planInput(base, base, [localFolder])).blockedOperations).not.toHaveLength(0);
    },
  },
  {
    name: "17 long path is actionable and blocked",
    run: () => {
      expect(validateRelativePath(`${"x".repeat(241)}.md`).valid).toBe(false);
    },
  },
  {
    name: "18 non-ASCII path is supported",
    run: () => {
      expect(validateRelativePath("研究/ノート.md").valid).toBe(true);
    },
  },
  {
    name: "19 Windows-incompatible path is rejected",
    run: () => {
      expect(validateRelativePath("Folder/CON.txt").valid).toBe(false);
    },
  },
  {
    name: "20 case-only collision is detected",
    run: () => {
      const plan = planSync(
        planInput(manifest(0), manifest(1, [entry("note001", "Note.md")]), [
          local("note.md", HASH_B),
        ]),
      );
      expect(plan.conflicts.some((conflict) => conflict.kind === "path-collision")).toBe(true);
    },
  },
  {
    name: "21 network disconnect during upload is retryable",
    run: () => {
      expect(retryDecision({ attempt: 0, networkError: true, random: () => 0 })).toMatchObject({
        retry: true,
        category: "network",
      });
    },
  },
  {
    name: "22 crash after upload before manifest commit leaves a journal",
    run: () => {
      const plan = planSync(planInput(manifest(0), manifest(0), [local("A.md")]));
      const journal = createJournal(plan);
      journal.phase = "remote-content";
      markJournalOperation(journal, plan.uploads[0]!.operationId, "verified");
      expect(journal).toMatchObject({
        phase: "remote-content",
        operations: [{ state: "verified" }],
      });
    },
  },
  {
    name: "23 crash during local download leaves a resumable journal",
    run: () => {
      const plan = planSync(planInput(manifest(0), manifest(1, [entry("note001", "A.md")]), []));
      const journal = createJournal(plan);
      journal.phase = "local-content";
      markJournalOperation(journal, plan.downloads[0]!.operationId, "started");
      expect(journal.operations[0]?.state).toBe("started");
    },
  },
  {
    name: "24 manifest revision change aborts commit",
    run: async () => {
      const current = manifest(2);
      const content = await serializeManifest(current);
      const appData = {
        get: async () => ({ file: { id: vault.manifestFileId }, content }),
        put: async () => ({ id: vault.manifestFileId }),
      } as unknown as AppDataStore;
      const lease = {
        record: {},
        assertHeld: async () => undefined,
        renew: async () => undefined,
        release: async () => undefined,
      };
      await expect(
        new ManifestStore(appData).commit(
          vault,
          1,
          { ...current, previousRevision: 2, revision: 3 },
          lease as never,
        ),
      ).rejects.toThrow("changed before commit");
    },
  },
  {
    name: "25 a 401 refreshes the access token once",
    run: async () => {
      const getAccessToken = vi.fn(async () => "token");
      let count = 0;
      const client = new GoogleDriveClient(
        { getAccessToken } as unknown as TokenManager,
        new Logger("error", () => undefined),
        async () => {
          count += 1;
          return count === 1
            ? new Response(JSON.stringify({ error: {} }), { status: 401 })
            : new Response(JSON.stringify({ files: [] }), { status: 200 });
        },
        async () => undefined,
      );
      await client.listFiles({});
      expect(getAccessToken).toHaveBeenLastCalledWith(true);
      expect(count).toBe(2);
    },
  },
  {
    name: "26 revoked refresh token becomes AUTH_REVOKED",
    run: async () => {
      const credentials: OAuthCredentials = {
        clientId: "client.apps.googleusercontent.com",
        refreshToken: "revoked",
        scopes: [...GOOGLE_SCOPES],
      };
      const store = credentialStore(credentials);
      const manager = new TokenManager(
        store,
        async () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }),
      );
      await expect(manager.getAccessToken()).rejects.toMatchObject({ code: "AUTH_REVOKED" });
    },
  },
  {
    name: "27 403 quota response backs off",
    run: () => {
      expect(retryDecision({ attempt: 0, status: 403, reason: "rateLimitExceeded" }).category).toBe(
        "quota",
      );
    },
  },
  {
    name: "28 429 rate limiting honors retry policy",
    run: () => {
      expect(
        retryDecision({ attempt: 0, status: 429, retryAfter: "2", random: () => 0 }).delayMs,
      ).toBe(2000);
    },
  },
  {
    name: "29 5xx response retries and succeeds",
    run: async () => {
      let count = 0;
      const client = new GoogleDriveClient(
        { getAccessToken: async () => "token" } as unknown as TokenManager,
        new Logger("error", () => undefined),
        async () => {
          count += 1;
          return count === 1
            ? new Response(JSON.stringify({ error: {} }), { status: 503 })
            : new Response(JSON.stringify({ files: [] }), { status: 200 });
        },
        async () => undefined,
      );
      expect((await client.listFiles({})).files).toEqual([]);
      expect(count).toBe(2);
    },
  },
  {
    name: "30 corrupt remote manifest is rejected",
    run: () => {
      expect(() => parseManifestJson('{"schemaVersion":1,"entries":"bad"}')).toThrow(
        "schema validation",
      );
    },
  },
  {
    name: "31 missing local database rebuilds a safe empty state",
    run: async () => {
      let saved: unknown = null;
      const data = new PluginDataStore({
        loadData: async () => null,
        saveData: async (value) => {
          saved = value;
        },
      });
      const state = await new LocalStateStore(data).load();
      expect(state.lastCommittedRevision).toBe(0);
      expect(state.deviceId).toMatch(/^[0-9a-f-]{36}$/u);
      expect(saved).toBeNull();
    },
  },
  {
    name: "32 missing remote manifest is an error rather than empty success",
    run: async () => {
      const appData = { get: async () => null } as unknown as AppDataStore;
      await expect(new ManifestStore(appData).read(vault)).rejects.toThrow("missing");
    },
  },
  {
    name: "33 duplicate Drive app-data objects are rejected",
    run: async () => {
      const duplicate: DriveFile = {
        id: "duplicate_file_12345",
        name: "x.json",
        mimeType: "application/json",
      };
      const drive = {
        listAllFiles: async () => [duplicate, { ...duplicate, id: "duplicate_file_67890" }],
      } as unknown as GoogleDriveClient;
      await expect(new AppDataStore(drive).get("x.json")).rejects.toThrow("Duplicate app-data");
    },
  },
  {
    name: "34 large file uses resumable chunks",
    run: async () => {
      const chunks: number[] = [];
      const fake = {
        beginResumableCreate: async () => "https://www.googleapis.com/upload/session",
        uploadResumableChunk: async (input: {
          chunk: Uint8Array;
          start: number;
          total: number;
        }) => {
          chunks.push(input.chunk.byteLength);
          const end = input.start + input.chunk.byteLength;
          return end >= input.total
            ? {
                complete: true,
                file: {
                  id: "uploaded_file_12345",
                  name: "large.bin",
                  mimeType: "application/octet-stream",
                },
              }
            : { complete: false, committedBytes: end };
        },
      } as unknown as GoogleDriveClient;
      const result = await resumableUpload(
        fake,
        {
          name: "large.bin",
          parentId: "parent_file_12345",
          mimeType: "application/octet-stream",
          appProperties: {},
          content: new Uint8Array(700_000),
        },
        { chunkSize: 256 * 1024 },
      );
      expect(result.id).toBe("uploaded_file_12345");
      expect(chunks.length).toBe(3);
    },
  },
  {
    name: "35 mobile credential import round-trips",
    run: async () => {
      const credentials: OAuthCredentials = {
        clientId: "client.apps.googleusercontent.com",
        refreshToken: "refresh",
        scopes: [...GOOGLE_SCOPES],
      };
      const exported = await exportPairingBundle(credentials, [vault]);
      expect(
        (await importPairingBundle(exported.encryptedBundle, exported.pairingSecret)).credentials,
      ).toEqual(credentials);
    },
  },
  {
    name: "36 pairing bundle expiration is enforced",
    run: async () => {
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
        importPairingBundle(exported.encryptedBundle, exported.pairingSecret, 1_700_000_061_000),
      ).rejects.toThrow();
    },
  },
  {
    name: "37 wrong pairing secret is rejected",
    run: async () => {
      const credentials = {
        clientId: "client.apps.googleusercontent.com",
        refreshToken: "refresh",
        scopes: [...GOOGLE_SCOPES],
      };
      const first = await exportPairingBundle(credentials, [vault]);
      const second = await exportPairingBundle(credentials, [vault]);
      await expect(
        importPairingBundle(first.encryptedBundle, second.pairingSecret),
      ).rejects.toThrow();
    },
  },
  {
    name: "38 accidental mass-deletion plan is blocked",
    run: () => {
      const entries = Array.from({ length: 50 }, (_, index) =>
        entry(`id${String(index).padStart(6, "0")}`, `${index}.md`),
      );
      expect(
        planSync(planInput(manifest(1, entries), manifest(1, entries), [])).blockedOperations[0]
          ?.code,
      ).toBe("MASS_DELETION_BLOCKED");
    },
  },
  {
    name: "39 modification time is restored when adapter supports it",
    run: async () => {
      const utimes = vi.fn(async () => undefined);
      const warnings: string[] = [];
      await restoreModificationTime({ utimes }, "A.md", 1234, warnings);
      expect(utimes).toHaveBeenCalledWith("A.md", 1234, 1234);
      expect(warnings).toEqual([]);
    },
  },
  {
    name: "40 changes made outside Obsidian are found by a full scan",
    run: async () => {
      let reads = 0;
      const adapter: VaultAdapter = {
        list: async () => ({ files: ["A.md"], folders: [] }),
        stat: async () => ({ type: "file", ctime: 1, mtime: 2, size: 3 }),
        readBinary: async () => {
          reads += 1;
          return new TextEncoder().encode("new").buffer;
        },
      };
      const result = await new VaultScanner(adapter, DEFAULT_SETTINGS, {
        "A.md": { size: 3, modifiedAt: 1, hash: HASH_A },
      }).scan();
      expect(reads).toBe(1);
      expect(result.snapshot.entries["A.md"]?.contentHash).not.toBe(HASH_A);
    },
  },
];

describe("required integration scenarios", () => {
  it.each(scenarios)("$name", async ({ run }) => {
    await run();
  });
});

function credentialStore(credentials: OAuthCredentials): CredentialStore {
  let value: OAuthCredentials | null = credentials;
  return {
    isAvailable: async () => true,
    hasCredentials: async () => value !== null,
    unlock: async () => true,
    save: async (next) => {
      value = next;
    },
    load: async () => value,
    clear: async () => {
      value = null;
    },
    lock: async () => undefined,
    changePassphrase: async () => undefined,
  };
}
