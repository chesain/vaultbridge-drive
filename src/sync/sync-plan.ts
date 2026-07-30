import type { LocalEvent } from "../local/event-queue";
import type { LocalSnapshot, ObjectType, SyncPolicy, VaultManifest } from "../types/domain";

export interface PlanInput {
  baseManifest: VaultManifest;
  remoteManifest: VaultManifest;
  localSnapshot: LocalSnapshot;
  pendingLocalEvents: LocalEvent[];
  deviceId: string;
  policy: SyncPolicy;
}

export interface BaseOperation {
  operationId: string;
  logicalId: string;
  path: string;
  reason: string;
}

export interface UploadOperation extends BaseOperation {
  kind: "create" | "update";
  objectType: ObjectType;
  parentLogicalId?: string;
  expectedDriveFileId?: string;
}

export interface DownloadOperation extends BaseOperation {
  kind: "create" | "update" | "conflict-copy";
  driveFileId: string;
  contentHash?: string;
  sourceModifiedAt?: number;
}

export interface MoveOperation extends BaseOperation {
  fromPath: string;
  toPath: string;
  objectType: ObjectType;
  driveFileId?: string;
}

export interface ConflictOperation extends BaseOperation {
  kind:
    | "both-modified"
    | "modify-delete"
    | "rename-delete"
    | "rename-modify"
    | "rename-rename"
    | "path-collision"
    | "type-collision";
  localPath?: string;
  remotePath?: string;
  basePath?: string;
  conflictPath: string;
  driveFileId?: string;
}

export interface TombstoneOperation extends BaseOperation {
  driveFileId?: string;
  previousPath: string;
  purgeAfter: string;
}

export interface RecoveryOperation extends BaseOperation {
  direction: "remote-to-recovery" | "local-to-recovery" | "restore-remote" | "restore-local";
  driveFileId?: string;
}

export interface PurgeOperation extends BaseOperation {
  driveFileId: string;
}

export interface SyncWarning {
  code: string;
  path?: string;
  message: string;
}

export interface BlockedOperation {
  code: string;
  path?: string;
  message: string;
  requiresConfirmation: boolean;
}

export interface SyncPlan {
  baseRevision: number;
  remoteRevision: number;
  uploads: UploadOperation[];
  downloads: DownloadOperation[];
  remoteMoves: MoveOperation[];
  localMoves: MoveOperation[];
  conflicts: ConflictOperation[];
  tombstonesToCreate: TombstoneOperation[];
  recoveries: RecoveryOperation[];
  purges: PurgeOperation[];
  warnings: SyncWarning[];
  blockedOperations: BlockedOperation[];
}

export function hardBlockedOperations(plan: SyncPlan): BlockedOperation[] {
  return plan.blockedOperations.filter((operation) => !operation.requiresConfirmation);
}

export function hasHardBlockedOperations(plan: SyncPlan): boolean {
  return hardBlockedOperations(plan).length > 0;
}
