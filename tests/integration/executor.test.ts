import { describe, expect, it } from "vitest";
import type { LeaseManager } from "../../src/drive/lease-manager";
import type { VaultDriveClient } from "../../src/drive/vault-drive-client";
import { sha256 } from "../../src/utils/crypto";
import type { ManifestStore } from "../../src/manifest/manifest-store";
import { PluginDataStore } from "../../src/storage/plugin-data-store";
import { LocalStateStore } from "../../src/storage/local-state-store";
import { SyncExecutor, type SyncLocalAdapter } from "../../src/sync/executor";
import { planSync } from "../../src/sync/planner";
import type { DriveFile } from "../../src/drive/drive-types";
import type { LocalFileState, VaultIdentity, VaultManifest } from "../../src/types/domain";
import {
  DEVICE_ID,
  VAULT_ID,
  entry,
  manifest,
  planInput,
  policy,
  snapshot,
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

describe("journaled executor", () => {
  it("uploads, verifies, and commits a local creation", async () => {
    const bytes = new TextEncoder().encode("hello");
    const hash = await sha256(bytes);
    const localState: LocalFileState = {
      relativePath: "A.md",
      objectType: "file",
      byteSize: bytes.byteLength,
      modifiedAt: 1234,
      contentHash: hash,
    };
    const local = new MemoryLocal({ "A.md": bytes });
    const remote = new MemoryRemote();
    const committed: VaultManifest[] = [];
    const stateStore = memoryStateStore();
    const base = manifest(0);
    const plan = planSync(planInput(base, base, [localState]));
    const executor = new SyncExecutor(
      local,
      remote as unknown as VaultDriveClient,
      manifestStore(committed),
      leaseManager(),
      stateStore,
    );
    const result = await executor.execute({
      plan,
      remoteManifest: base,
      localSnapshot: snapshot([localState]),
      vault,
      deviceId: DEVICE_ID,
      policy,
    });
    expect(result.committed).toBe(true);
    expect(Object.values(result.manifest.entries)).toMatchObject([
      { relativePath: "A.md", contentHash: hash },
    ]);
    expect(committed).toHaveLength(1);
    expect((await stateStore.load()).journal).toBeUndefined();
  });

  it("stages, verifies, installs, and restores mtime for a remote file", async () => {
    const bytes = new TextEncoder().encode("remote");
    const hash = await sha256(bytes);
    const remoteEntry = entry("note001", "A.md", hash, {
      byteSize: bytes.byteLength,
      sourceModifiedAt: 9876,
      driveFileId: "remote_note_12345",
    });
    const remoteManifest = manifest(1, [remoteEntry]);
    const local = new MemoryLocal({});
    const remote = new MemoryRemote({ [remoteEntry.driveFileId]: bytes });
    const executor = new SyncExecutor(
      local,
      remote as unknown as VaultDriveClient,
      manifestStore([]),
      leaseManager(),
      memoryStateStore(),
    );
    await executor.execute({
      plan: planSync(planInput(manifest(0), remoteManifest, [])),
      remoteManifest,
      localSnapshot: snapshot([]),
      vault,
      deviceId: DEVICE_ID,
      policy,
    });
    expect(new TextDecoder().decode(local.files.get("A.md"))).toBe("remote");
    expect(local.mtimes.get("A.md")).toBe(9876);
    expect([...local.files.keys()].some((path) => path.endsWith(".part"))).toBe(false);
  });

  it("does not execute a mass-deletion plan without confirmation", async () => {
    const entries = Array.from({ length: 30 }, (_, index) =>
      entry(`id${String(index).padStart(6, "0")}`, `${index}.md`),
    );
    const remoteManifest = manifest(1, entries);
    const plan = planSync(planInput(remoteManifest, remoteManifest, []));
    const executor = new SyncExecutor(
      new MemoryLocal({}),
      new MemoryRemote() as unknown as VaultDriveClient,
      manifestStore([]),
      leaseManager(),
      memoryStateStore(),
    );
    await expect(
      executor.execute({
        plan,
        remoteManifest,
        localSnapshot: snapshot([]),
        vault,
        deviceId: DEVICE_ID,
        policy,
      }),
    ).rejects.toMatchObject({ code: "MASS_DELETION_BLOCKED" });
  });
});

class MemoryLocal implements SyncLocalAdapter {
  readonly files = new Map<string, Uint8Array>();
  readonly directories = new Set<string>();
  readonly mtimes = new Map<string, number>();

  constructor(files: Record<string, Uint8Array>) {
    for (const [path, bytes] of Object.entries(files)) this.files.set(path, bytes);
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(path) || this.directories.has(path);
  }

  async mkdir(path: string): Promise<void> {
    this.directories.add(path);
  }

  async readBinary(path: string): Promise<ArrayBuffer> {
    const bytes = this.files.get(path);
    if (bytes === undefined) throw new Error(`Missing ${path}`);
    return bytes.slice().buffer;
  }

  async writeBinary(path: string, data: ArrayBuffer): Promise<void> {
    this.files.set(path, new Uint8Array(data.slice(0)));
  }

  async rename(from: string, to: string): Promise<void> {
    const bytes = this.files.get(from);
    if (bytes !== undefined) {
      this.files.delete(from);
      this.files.set(to, bytes);
      return;
    }
    if (this.directories.delete(from)) {
      this.directories.add(to);
      return;
    }
    throw new Error(`Missing rename source ${from}`);
  }

  async remove(path: string): Promise<void> {
    this.files.delete(path);
    this.directories.delete(path);
  }

  async utimes(path: string, _atime: number, mtime: number): Promise<void> {
    this.mtimes.set(path, mtime);
  }
}

class MemoryRemote {
  readonly vault = vault;
  private readonly files = new Map<string, Uint8Array>();
  private counter = 0;

  constructor(files: Record<string, Uint8Array> = {}) {
    for (const [id, bytes] of Object.entries(files)) this.files.set(id, bytes);
  }

  async uploadVaultFile(
    _parentId: string,
    _logicalId: string,
    input: { name: string; mimeType: string; content: Uint8Array },
  ): Promise<DriveFile> {
    this.counter += 1;
    const id = `created_file_${String(this.counter).padStart(6, "0")}`;
    this.files.set(id, input.content.slice());
    return { id, name: input.name, mimeType: input.mimeType };
  }

  async downloadVaultFile(
    _logicalId: string,
    fileId: string,
  ): Promise<{ file: DriveFile; content: Uint8Array }> {
    const content = this.files.get(fileId);
    if (content === undefined) throw new Error(`Missing remote ${fileId}`);
    return {
      file: { id: fileId, name: "A.md", mimeType: "text/markdown" },
      content: content.slice(),
    };
  }
}

function memoryStateStore(): LocalStateStore {
  let data: unknown = null;
  return new LocalStateStore(
    new PluginDataStore({
      loadData: async () => data,
      saveData: async (next) => {
        data = next;
      },
    }),
  );
}

function manifestStore(committed: VaultManifest[]): ManifestStore {
  return {
    commit: async (_vault: VaultIdentity, _revision: number, next: VaultManifest) => {
      committed.push(structuredClone(next));
      return { manifest: next, etag: "etag" };
    },
  } as unknown as ManifestStore;
}

function leaseManager(): LeaseManager {
  return {
    acquire: async () => ({
      record: {
        version: 1,
        vaultId: VAULT_ID,
        deviceId: DEVICE_ID,
        token: "lease_token_123456",
        createdAt: "2026-07-21T10:00:00.000Z",
        renewedAt: "2026-07-21T10:00:00.000Z",
        expiresAt: "2026-07-21T10:01:00.000Z",
      },
      assertHeld: async () => undefined,
      renew: async () => undefined,
      release: async () => undefined,
    }),
  } as unknown as LeaseManager;
}
