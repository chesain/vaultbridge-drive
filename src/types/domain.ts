export type ObjectType = "file" | "folder";

export interface VaultIdentity {
  vaultId: string;
  shortVaultId: string;
  displayName: string;
  rootFolderId: string;
  recoveryFolderId: string;
  manifestFileId: string;
  createdAt: string;
  schemaVersion: number;
}

export interface ManifestEntry {
  logicalId: string;
  driveFileId: string;
  relativePath: string;
  objectType: ObjectType;
  contentHash?: string;
  byteSize?: number;
  sourceModifiedAt?: number;
  remoteRevision: number;
  parentLogicalId?: string;
  mimeType?: string;
}

export interface TombstoneEntry {
  logicalId: string;
  previousPath: string;
  driveFileId?: string;
  deletedAt: string;
  deletedByDeviceId: string;
  deletionRevision: number;
  purgeAfter: string;
}

export interface VaultManifest {
  schemaVersion: number;
  vaultId: string;
  revision: number;
  previousRevision?: number;
  updatedAt: string;
  updatedByDeviceId: string;
  entries: Record<string, ManifestEntry>;
  tombstones: Record<string, TombstoneEntry>;
  checksum?: string;
}

export interface LocalFileState {
  logicalId?: string;
  relativePath: string;
  objectType: ObjectType;
  byteSize?: number;
  modifiedAt?: number;
  contentHash?: string;
}

export interface LocalSnapshot {
  scannedAt: string;
  entries: Record<string, LocalFileState>;
  blockedPaths: Array<{ path: string; reasons: string[] }>;
}

export interface OAuthCredentials {
  clientId: string;
  clientSecret?: string;
  refreshToken: string;
  accessToken?: string;
  accessTokenExpiresAt?: number;
  scopes: string[];
  tokenType?: string;
  accountEmail?: string;
  accountDisplayName?: string;
}

export interface DeviceAuthorization {
  deviceId: string;
  displayName: string;
  addedAt: string;
  lastSeenAt?: string;
}

export interface VaultRegistry {
  schemaVersion: number;
  updatedAt: string;
  vaults: VaultIdentity[];
}

export interface SyncPolicy {
  deviceName: string;
  conflictTimestamp?: string;
  recoveryRetentionDays: number;
  massDeletionFileThreshold: number;
  massDeletionPercentThreshold: number;
  maxPathLength: number;
  maxFilenameLength: number;
}

export type SyncPhase =
  | "idle"
  | "locked"
  | "authenticating"
  | "scanning"
  | "planning"
  | "uploading"
  | "downloading"
  | "resolving"
  | "committing"
  | "up-to-date"
  | "conflict"
  | "action-required"
  | "offline"
  | "error";

export interface SyncHistoryItem {
  id: string;
  startedAt: string;
  finishedAt: string;
  outcome: "success" | "cancelled" | "blocked" | "error";
  fromRevision?: number;
  toRevision?: number;
  counts: Record<string, number>;
  message: string;
}

export interface PendingOperationRecord {
  operationId: string;
  kind: string;
  logicalId: string;
  relativePath: string;
  createdAt: string;
  state: "planned" | "started" | "verified" | "applied";
}

export interface TransactionJournal {
  transactionId: string;
  startedAt: string;
  baseRevision: number;
  targetRevision: number;
  phase:
    | "planned"
    | "remote-content"
    | "local-content"
    | "moves"
    | "recovery"
    | "manifest"
    | "committed";
  operations: PendingOperationRecord[];
}

export interface LocalSyncState {
  schemaVersion: number;
  deviceId: string;
  lastCommittedRevision: number;
  lastKnownEtag?: string;
  lastLocalScan?: string;
  baseManifest?: VaultManifest;
  localHashes: Record<string, { size: number; modifiedAt: number; hash: string }>;
  pendingOperations: PendingOperationRecord[];
  journal?: TransactionJournal;
  exclusions: string[];
  history: SyncHistoryItem[];
  recoveryRecords: TombstoneEntry[];
  authState: "disconnected" | "locked" | "ready" | "revoked";
}
