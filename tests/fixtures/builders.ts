import type {
  LocalFileState,
  LocalSnapshot,
  ManifestEntry,
  SyncPolicy,
  TombstoneEntry,
  VaultManifest,
} from "../../src/types/domain";
import type { PlanInput } from "../../src/sync/sync-plan";

export const VAULT_ID = "11111111-1111-4111-8111-111111111111";
export const DEVICE_ID = "22222222-2222-4222-8222-222222222222";
export const OTHER_DEVICE_ID = "33333333-3333-4333-8333-333333333333";
export const HASH_A = "a".repeat(64);
export const HASH_B = "b".repeat(64);
export const HASH_C = "c".repeat(64);

export function entry(
  logicalId: string,
  relativePath: string,
  contentHash = HASH_A,
  options: Partial<ManifestEntry> = {},
): ManifestEntry {
  return {
    logicalId,
    driveFileId: `drive_${logicalId}_123456`,
    relativePath,
    objectType: "file",
    contentHash,
    byteSize: 10,
    sourceModifiedAt: 1_700_000_000_000,
    remoteRevision: 1,
    mimeType: "text/markdown",
    ...options,
  };
}

export function folder(
  logicalId: string,
  relativePath: string,
  options: Partial<ManifestEntry> = {},
): ManifestEntry {
  return entry(logicalId, relativePath, HASH_A, {
    objectType: "folder",
    contentHash: undefined,
    byteSize: undefined,
    mimeType: undefined,
    ...options,
  });
}

export function tombstone(logicalId: string, path: string, revision = 2): TombstoneEntry {
  return {
    logicalId,
    previousPath: path,
    driveFileId: `drive_${logicalId}_123456`,
    deletedAt: "2026-07-21T10:00:00.000Z",
    deletedByDeviceId: OTHER_DEVICE_ID,
    deletionRevision: revision,
    purgeAfter: "2026-08-20T10:00:00.000Z",
  };
}

export function manifest(
  revision: number,
  entries: ManifestEntry[] = [],
  tombstones: TombstoneEntry[] = [],
): VaultManifest {
  return {
    schemaVersion: 1,
    vaultId: VAULT_ID,
    revision,
    ...(revision > 0 ? { previousRevision: revision - 1 } : {}),
    updatedAt: `2026-07-21T10:${String(revision).padStart(2, "0")}:00.000Z`,
    updatedByDeviceId: OTHER_DEVICE_ID,
    entries: Object.fromEntries(entries.map((item) => [item.logicalId, item])),
    tombstones: Object.fromEntries(tombstones.map((item) => [item.logicalId, item])),
  };
}

export function local(
  relativePath: string,
  contentHash = HASH_A,
  options: Partial<LocalFileState> = {},
): LocalFileState {
  return {
    relativePath,
    objectType: "file",
    contentHash,
    byteSize: 10,
    modifiedAt: 1_700_000_000_000,
    ...options,
  };
}

export function snapshot(entries: LocalFileState[] = []): LocalSnapshot {
  return {
    scannedAt: "2026-07-21T10:10:00.000Z",
    entries: Object.fromEntries(entries.map((item) => [item.relativePath, item])),
    blockedPaths: [],
  };
}

export const policy: SyncPolicy = {
  deviceName: "MacBook",
  conflictTimestamp: "2026-07-21T14:32:00.000Z",
  recoveryRetentionDays: 30,
  massDeletionFileThreshold: 20,
  massDeletionPercentThreshold: 10,
  maxPathLength: 240,
  maxFilenameLength: 180,
};

export function planInput(
  baseManifest: VaultManifest,
  remoteManifest: VaultManifest,
  localEntries: LocalFileState[],
  overrides: Partial<PlanInput> = {},
): PlanInput {
  return {
    baseManifest,
    remoteManifest,
    localSnapshot: snapshot(localEntries),
    pendingLocalEvents: [],
    deviceId: DEVICE_ID,
    policy,
    ...overrides,
  };
}
