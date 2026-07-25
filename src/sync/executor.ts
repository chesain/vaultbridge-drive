import type {
  LocalFileState,
  LocalSnapshot,
  LocalSyncState,
  ManifestEntry,
  SyncHistoryItem,
  SyncPolicy,
  TransactionJournal,
  VaultIdentity,
  VaultManifest,
} from "../types/domain";
import { SyncError } from "../types/sync-errors";
import { assertSafeRelativePath } from "../local/path-validator";
import { sha256 } from "../utils/crypto";
import type { VaultDriveClient } from "../drive/vault-drive-client";
import type { LeaseManager } from "../drive/lease-manager";
import type { ManifestStore } from "../manifest/manifest-store";
import { validateManifest } from "../manifest/manifest-schema";
import type { LocalStateStore } from "../storage/local-state-store";
import type { SyncPlan, UploadOperation } from "./sync-plan";
import { createJournal, markJournalOperation } from "./transaction-journal";
import { createTombstone } from "../recovery/tombstones";

export interface SyncLocalAdapter {
  exists(path: string): Promise<boolean>;
  mkdir(path: string): Promise<void>;
  readBinary(path: string): Promise<ArrayBuffer>;
  writeBinary(path: string, data: ArrayBuffer): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
  utimes?(path: string, atime: number, mtime: number): Promise<void>;
}

export interface ExecuteInput {
  plan: SyncPlan;
  remoteManifest: VaultManifest;
  localSnapshot: LocalSnapshot;
  vault: VaultIdentity;
  deviceId: string;
  policy: SyncPolicy;
  signal?: AbortSignal;
  confirmMassDeletion?: boolean;
  dryRun?: boolean;
  onPhase?: (phase: "uploading" | "downloading" | "resolving" | "committing") => void;
}

export interface ExecuteResult {
  committed: boolean;
  manifest: VaultManifest;
  history: SyncHistoryItem;
  warnings: string[];
}

interface StagedDownload {
  operationId: string;
  path: string;
  tempPath: string;
  backupPath: string;
  sourceModifiedAt?: number;
}

export class SyncExecutor {
  constructor(
    private readonly local: SyncLocalAdapter,
    private readonly remote: VaultDriveClient,
    private readonly manifestStore: ManifestStore,
    private readonly leaseManager: LeaseManager,
    private readonly stateStore: LocalStateStore,
  ) {}

  async execute(input: ExecuteInput): Promise<ExecuteResult> {
    const startedAt = new Date();
    this.assertPlanExecutable(input);
    const state = await this.stateStore.load();
    const journal = createJournal(input.plan, startedAt);
    state.journal = journal;
    state.pendingOperations = journal.operations;
    await this.stateStore.save(state);
    const working = structuredClone(input.remoteManifest);
    delete working.checksum;
    const warnings: string[] = [];
    if (input.dryRun === true) {
      const history = historyItem(
        journal,
        startedAt,
        new Date(),
        "success",
        input.plan,
        "Dry run; no changes applied",
      );
      state.journal = undefined;
      state.pendingOperations = [];
      state.history.push(history);
      await this.stateStore.save(state);
      return { committed: false, manifest: working, history, warnings };
    }

    const replaced = new Map<string, { oldFileId: string; oldParentId: string }>();
    try {
      journal.phase = "remote-content";
      input.onPhase?.("uploading");
      await this.saveJournal(state, journal);
      for (const operation of sortUploads(input.plan.uploads)) {
        this.checkCancelled(input.signal);
        await this.executeUpload(operation, input, working, replaced);
        markJournalOperation(journal, operation.operationId, "verified");
        await this.saveJournal(state, journal);
      }

      journal.phase = "local-content";
      input.onPhase?.("downloading");
      await this.saveJournal(state, journal);
      const staged = await this.stageDownloads(input, journal, state);

      journal.phase = "moves";
      input.onPhase?.("resolving");
      await this.saveJournal(state, journal);
      for (const operation of input.plan.localMoves) {
        this.checkCancelled(input.signal);
        await this.executeLocalMove(operation.fromPath, operation.toPath, operation.objectType);
        markJournalOperation(journal, operation.operationId, "applied");
      }
      for (const download of staged) {
        await this.finalizeDownload(download, warnings);
        markJournalOperation(journal, download.operationId, "applied");
      }
      for (const operation of input.plan.remoteMoves) {
        this.checkCancelled(input.signal);
        if (replaced.has(operation.logicalId)) {
          markJournalOperation(journal, operation.operationId, "applied");
          continue;
        }
        await this.executeRemoteMove(
          operation.logicalId,
          operation.fromPath,
          operation.toPath,
          operation.objectType,
          working,
          input.signal,
        );
        markJournalOperation(journal, operation.operationId, "applied");
      }
      await this.saveJournal(state, journal);

      journal.phase = "recovery";
      await this.saveJournal(state, journal);
      for (const operation of input.plan.recoveries) {
        this.checkCancelled(input.signal);
        if (operation.direction === "local-to-recovery") {
          await this.moveLocalToRecovery(operation.path, journal.transactionId);
        } else if (
          operation.direction === "remote-to-recovery" &&
          operation.driveFileId !== undefined
        ) {
          const entry = working.entries[operation.logicalId];
          const parentRecovery = input.plan.recoveries.some(
            (candidate) =>
              candidate.direction === "remote-to-recovery" &&
              candidate.path !== operation.path &&
              operation.path.startsWith(`${candidate.path}/`),
          );
          if (entry !== undefined && !parentRecovery) {
            const parentId = parentDriveId(entry, working, input.vault);
            await this.remote.moveVaultObjectToRecovery(
              operation.logicalId,
              operation.driveFileId,
              entry.objectType,
              parentId,
              input.signal,
            );
          }
        }
        markJournalOperation(journal, operation.operationId, "applied");
      }
      applyTombstones(working, input, startedAt);

      const targetRevision = input.remoteManifest.revision + 1;
      working.previousRevision = input.remoteManifest.revision;
      working.revision = targetRevision;
      working.updatedAt = new Date().toISOString();
      working.updatedByDeviceId = input.deviceId;
      for (const entry of Object.values(working.entries)) {
        if (entry.remoteRevision > targetRevision) entry.remoteRevision = targetRevision;
      }
      const next = validateManifest(working);

      journal.phase = "manifest";
      input.onPhase?.("committing");
      await this.saveJournal(state, journal);
      const lease = await this.leaseManager.acquire(
        input.vault.vaultId,
        input.vault.shortVaultId,
        input.deviceId,
        30_000,
        input.signal,
      );
      let committed: VaultManifest;
      let etag: string | undefined;
      try {
        const result = await this.manifestStore.commit(
          input.vault,
          input.remoteManifest.revision,
          next,
          lease,
          input.signal,
        );
        committed = result.manifest;
        etag = result.etag;
      } finally {
        await lease.release(input.signal).catch(() => undefined);
      }

      journal.phase = "committed";
      const finishedAt = new Date();
      const history = historyItem(
        journal,
        startedAt,
        finishedAt,
        "success",
        input.plan,
        "Synchronization committed",
      );
      state.lastCommittedRevision = committed.revision;
      state.lastKnownEtag = etag;
      state.lastLocalScan = input.localSnapshot.scannedAt;
      state.baseManifest = committed;
      state.localHashes = Object.fromEntries(
        Object.values(input.localSnapshot.entries)
          .filter(
            (
              entry,
            ): entry is LocalFileState & {
              byteSize: number;
              modifiedAt: number;
              contentHash: string;
            } =>
              entry.objectType === "file" &&
              entry.byteSize !== undefined &&
              entry.modifiedAt !== undefined &&
              entry.contentHash !== undefined,
          )
          .map((entry) => [
            entry.relativePath,
            { size: entry.byteSize, modifiedAt: entry.modifiedAt, hash: entry.contentHash },
          ]),
      );
      state.pendingOperations = [];
      state.journal = undefined;
      state.history.push(history);
      await this.stateStore.save(state);

      for (const [logicalId, orphan] of replaced) {
        try {
          await this.remote.moveVaultFileToRecovery(
            logicalId,
            orphan.oldFileId,
            orphan.oldParentId,
            input.signal,
          );
        } catch {
          warnings.push(
            `Superseded remote object for ${logicalId} remains for later orphan cleanup`,
          );
        }
      }
      return { committed: true, manifest: committed, history, warnings };
    } catch (error) {
      const finishedAt = new Date();
      const cancelled = input.signal?.aborted === true;
      const history = historyItem(
        journal,
        startedAt,
        finishedAt,
        cancelled ? "cancelled" : "error",
        input.plan,
        cancelled
          ? "Synchronization cancelled"
          : error instanceof Error
            ? error.message
            : "Synchronization failed",
      );
      state.history.push(history);
      state.journal = journal;
      state.pendingOperations = journal.operations;
      await this.stateStore.save(state);
      throw error;
    }
  }

  private assertPlanExecutable(input: ExecuteInput): void {
    const hard = input.plan.blockedOperations.filter((item) => !item.requiresConfirmation);
    const mass = input.plan.blockedOperations.filter(
      (item) => item.code === "MASS_DELETION_BLOCKED",
    );
    if (hard.length > 0) {
      throw new SyncError(
        "PATH_UNSUPPORTED",
        hard[0]?.message ?? "Plan contains blocked operations",
        {
          retrySafe: false,
          userActionRequired: true,
          resumable: false,
          dataAtRisk: false,
        },
      );
    }
    if (mass.length > 0 && input.confirmMassDeletion !== true) {
      throw new SyncError("MASS_DELETION_BLOCKED", mass[0]?.message ?? "Mass deletion blocked", {
        retrySafe: false,
        userActionRequired: true,
        resumable: true,
        dataAtRisk: true,
      });
    }
  }

  private async executeUpload(
    operation: UploadOperation,
    input: ExecuteInput,
    working: VaultManifest,
    replaced: Map<string, { oldFileId: string; oldParentId: string }>,
  ): Promise<void> {
    const local = input.localSnapshot.entries[operation.path];
    if (local === undefined || local.objectType !== operation.objectType) {
      throw new SyncError(
        "LOCAL_STATE_INVALID",
        `Local upload source disappeared: ${operation.path}`,
        {
          retrySafe: true,
          userActionRequired: false,
          resumable: true,
          dataAtRisk: false,
        },
      );
    }
    const parentLogicalId = findParentLogicalId(operation.path, working);
    const parentId =
      parentLogicalId === undefined
        ? input.vault.rootFolderId
        : working.entries[parentLogicalId]?.driveFileId;
    if (parentId === undefined) throw new Error(`Remote parent is missing for ${operation.path}`);
    const name = basename(operation.path);
    const previous = working.entries[operation.logicalId];
    if (operation.objectType === "folder") {
      const created = await this.remote.createVaultFolder(
        parentId,
        operation.logicalId,
        name,
        input.signal,
      );
      working.entries[operation.logicalId] = {
        logicalId: operation.logicalId,
        driveFileId: created.id,
        relativePath: operation.path,
        objectType: "folder",
        remoteRevision: input.remoteManifest.revision + 1,
        ...(parentLogicalId === undefined ? {} : { parentLogicalId }),
      };
      return;
    }
    const bytes = new Uint8Array(await this.local.readBinary(operation.path));
    const expectedHash = local.contentHash ?? (await sha256(bytes));
    if ((await sha256(bytes)) !== expectedHash) throw hashMismatch(operation.path);
    const created = await this.remote.uploadVaultFile(
      parentId,
      operation.logicalId,
      {
        name,
        mimeType: mimeTypeFor(operation.path),
        content: bytes,
        modifiedTime:
          local.modifiedAt === undefined ? undefined : new Date(local.modifiedAt).toISOString(),
      },
      input.signal,
    );
    const verified = await this.remote.downloadVaultFile(
      operation.logicalId,
      created.id,
      parentId,
      input.signal,
    );
    if ((await sha256(verified.content)) !== expectedHash) throw hashMismatch(operation.path);
    if (previous !== undefined) {
      replaced.set(operation.logicalId, {
        oldFileId: previous.driveFileId,
        oldParentId: parentDriveId(previous, working, input.vault),
      });
    }
    working.entries[operation.logicalId] = {
      logicalId: operation.logicalId,
      driveFileId: created.id,
      relativePath: operation.path,
      objectType: "file",
      contentHash: expectedHash,
      byteSize: bytes.byteLength,
      sourceModifiedAt: local.modifiedAt,
      remoteRevision: input.remoteManifest.revision + 1,
      ...(parentLogicalId === undefined ? {} : { parentLogicalId }),
      mimeType: mimeTypeFor(operation.path),
    };
  }

  private async stageDownloads(
    input: ExecuteInput,
    journal: TransactionJournal,
    state: LocalSyncState,
  ): Promise<StagedDownload[]> {
    const staged: StagedDownload[] = [];
    for (const operation of input.plan.downloads) {
      this.checkCancelled(input.signal);
      const remoteEntry = input.remoteManifest.entries[operation.logicalId];
      const downloaded = await this.remote.downloadVaultFile(
        operation.logicalId,
        operation.driveFileId,
        remoteEntry === undefined
          ? undefined
          : parentDriveId(remoteEntry, input.remoteManifest, input.vault),
        input.signal,
      );
      const hash = await sha256(downloaded.content);
      if (operation.contentHash !== undefined && hash !== operation.contentHash)
        throw hashMismatch(operation.path);
      const safeId = operation.operationId.replace(/[^A-Za-z0-9_-]/gu, "_");
      const tempPath = `.obsidian/plugins/vaultbridge-drive/tmp/${journal.transactionId}/${safeId}.part`;
      const backupPath = `${tempPath}.backup`;
      await this.ensureParent(tempPath);
      await this.local.writeBinary(tempPath, downloaded.content.buffer);
      if ((await sha256(await this.local.readBinary(tempPath))) !== hash)
        throw hashMismatch(operation.path);
      staged.push({
        operationId: operation.operationId,
        path: operation.path,
        tempPath,
        backupPath,
        sourceModifiedAt: operation.sourceModifiedAt,
      });
      markJournalOperation(journal, operation.operationId, "verified");
      await this.saveJournal(state, journal);
    }
    return staged;
  }

  private async finalizeDownload(download: StagedDownload, warnings: string[]): Promise<void> {
    assertSafeRelativePath(download.path);
    await this.ensureParent(download.path);
    if (await this.local.exists(download.backupPath)) await this.local.remove(download.backupPath);
    if (await this.local.exists(download.path))
      await this.local.rename(download.path, download.backupPath);
    try {
      await this.local.rename(download.tempPath, download.path);
      if (await this.local.exists(download.backupPath))
        await this.local.remove(download.backupPath);
    } catch (error) {
      if (await this.local.exists(download.backupPath))
        await this.local.rename(download.backupPath, download.path);
      throw error;
    }
    if (download.sourceModifiedAt !== undefined) {
      await restoreModificationTime(this.local, download.path, download.sourceModifiedAt, warnings);
    }
  }

  private async executeLocalMove(
    from: string,
    to: string,
    objectType: "file" | "folder",
  ): Promise<void> {
    assertSafeRelativePath(to);
    if (from === "" && objectType === "folder") {
      await this.ensureDirectory(to);
      return;
    }
    assertSafeRelativePath(from);
    if (!(await this.local.exists(from))) return;
    await this.ensureParent(to);
    if (await this.local.exists(to)) {
      throw new SyncError("PATH_UNSUPPORTED", `Rename destination already exists: ${to}`, {
        retrySafe: false,
        userActionRequired: true,
        resumable: true,
        dataAtRisk: false,
      });
    }
    await this.local.rename(from, to);
  }

  private async executeRemoteMove(
    logicalId: string,
    fromPath: string,
    toPath: string,
    objectType: "file" | "folder",
    working: VaultManifest,
    signal?: AbortSignal,
  ): Promise<void> {
    const entry = working.entries[logicalId];
    if (entry === undefined) return;
    const fromParent = parentDriveId(entry, working, this.remote.vault);
    const parentLogicalId = findParentLogicalId(toPath, working);
    const toParent =
      parentLogicalId === undefined
        ? this.remote.vault.rootFolderId
        : working.entries[parentLogicalId]?.driveFileId;
    if (toParent === undefined) throw new Error(`Remote move parent is missing for ${toPath}`);
    if (fromParent !== toParent) {
      await this.remote.moveVaultObject(
        logicalId,
        entry.driveFileId,
        objectType,
        fromParent,
        toParent,
        signal,
      );
    }
    if (basename(fromPath) !== basename(toPath)) {
      await this.remote.renameVaultObject(
        logicalId,
        entry.driveFileId,
        objectType,
        basename(toPath),
        toParent,
        signal,
      );
    }
    const oldPrefix = `${entry.relativePath}/`;
    entry.relativePath = toPath;
    entry.parentLogicalId = parentLogicalId;
    entry.remoteRevision = working.revision + 1;
    if (objectType === "folder") {
      for (const child of Object.values(working.entries)) {
        if (child.relativePath.startsWith(oldPrefix))
          child.relativePath = `${toPath}/${child.relativePath.slice(oldPrefix.length)}`;
      }
    }
  }

  private async moveLocalToRecovery(path: string, transactionId: string): Promise<void> {
    if (!(await this.local.exists(path))) return;
    const target = `.trash/VaultBridge Recovery/${transactionId}/${path}`;
    await this.ensureParent(target);
    if (!(await this.local.exists(target))) await this.local.rename(path, target);
  }

  private async ensureParent(path: string): Promise<void> {
    const index = path.lastIndexOf("/");
    if (index > 0) await this.ensureDirectory(path.slice(0, index));
  }

  private async ensureDirectory(path: string): Promise<void> {
    const parts = path.split("/");
    let current = "";
    for (const part of parts) {
      current = current === "" ? part : `${current}/${part}`;
      if (!(await this.local.exists(current))) await this.local.mkdir(current);
    }
  }

  private checkCancelled(signal?: AbortSignal): void {
    if (signal?.aborted === true) {
      throw new SyncError("USER_CANCELLED", "Synchronization cancelled", {
        retrySafe: true,
        userActionRequired: false,
        resumable: true,
        dataAtRisk: false,
        cause: signal.reason,
      });
    }
  }

  private async saveJournal(state: LocalSyncState, journal: TransactionJournal): Promise<void> {
    state.journal = journal;
    state.pendingOperations = journal.operations;
    await this.stateStore.save(state);
  }
}

export async function restoreModificationTime(
  adapter: Pick<SyncLocalAdapter, "utimes">,
  path: string,
  sourceModifiedAt: number,
  warnings: string[],
): Promise<void> {
  if (adapter.utimes !== undefined) {
    await adapter.utimes(path, sourceModifiedAt, sourceModifiedAt);
  } else {
    warnings.push(`This platform could not restore modification time for ${path}`);
  }
}

function applyTombstones(working: VaultManifest, input: ExecuteInput, now: Date): void {
  for (const operation of input.plan.tombstonesToCreate) {
    const entry = working.entries[operation.logicalId];
    if (entry === undefined) continue;
    working.tombstones[operation.logicalId] = createTombstone(
      entry,
      input.deviceId,
      input.remoteManifest.revision + 1,
      input.policy.recoveryRetentionDays,
      now,
    );
    delete working.entries[operation.logicalId];
  }
}

function findParentLogicalId(path: string, manifest: VaultManifest): string | undefined {
  const index = path.lastIndexOf("/");
  if (index < 0) return undefined;
  const parentPath = path.slice(0, index);
  return Object.values(manifest.entries).find(
    (entry) => entry.objectType === "folder" && entry.relativePath === parentPath,
  )?.logicalId;
}

function parentDriveId(
  entry: ManifestEntry,
  manifest: VaultManifest,
  vault: VaultIdentity,
): string {
  if (entry.parentLogicalId === undefined) return vault.rootFolderId;
  const parent = manifest.entries[entry.parentLogicalId];
  if (parent === undefined || parent.objectType !== "folder")
    throw new Error(`Manifest parent missing for ${entry.relativePath}`);
  return parent.driveFileId;
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function mimeTypeFor(path: string): string {
  const extension = path.slice(path.lastIndexOf(".") + 1).toLocaleLowerCase();
  const known: Record<string, string> = {
    md: "text/markdown",
    txt: "text/plain",
    json: "application/json",
    pdf: "application/pdf",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    svg: "image/svg+xml",
    mp3: "audio/mpeg",
    mp4: "video/mp4",
  };
  return known[extension] ?? "application/octet-stream";
}

function sortUploads(operations: UploadOperation[]): UploadOperation[] {
  return [...operations].sort((a, b) => {
    if (a.objectType !== b.objectType) return a.objectType === "folder" ? -1 : 1;
    return (
      a.path.split("/").length - b.path.split("/").length ||
      a.operationId.localeCompare(b.operationId)
    );
  });
}

function hashMismatch(path: string): SyncError {
  return new SyncError("HASH_MISMATCH", `Content hash verification failed: ${path}`, {
    retrySafe: true,
    userActionRequired: true,
    resumable: true,
    dataAtRisk: true,
  });
}

function historyItem(
  journal: TransactionJournal,
  startedAt: Date,
  finishedAt: Date,
  outcome: SyncHistoryItem["outcome"],
  plan: SyncPlan,
  message: string,
): SyncHistoryItem {
  return {
    id: journal.transactionId,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    outcome,
    fromRevision: journal.baseRevision,
    toRevision: outcome === "success" ? journal.targetRevision : undefined,
    counts: {
      uploads: plan.uploads.length,
      downloads: plan.downloads.length,
      remoteMoves: plan.remoteMoves.length,
      localMoves: plan.localMoves.length,
      conflicts: plan.conflicts.length,
      tombstones: plan.tombstonesToCreate.length,
      recoveries: plan.recoveries.length,
      blocked: plan.blockedOperations.length,
    },
    message,
  };
}
