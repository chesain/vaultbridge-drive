import { validateManifest } from "../manifest/manifest-schema";
import { validateRelativePath } from "../local/path-validator";
import type { LocalFileState, ManifestEntry, TombstoneEntry } from "../types/domain";
import { classifyLocal, classifyRemote, sameContent, type ChangeKind } from "./classifier";
import { conflictPath } from "./conflict-policy";
import { assignLocalLogicalIds } from "./rename-detector";
import type {
  BlockedOperation,
  ConflictOperation,
  PlanInput,
  RecoveryOperation,
  SyncPlan,
  TombstoneOperation,
} from "./sync-plan";

export function planSync(input: PlanInput): SyncPlan {
  const base = validateManifest(input.baseManifest);
  const remote = validateManifest(input.remoteManifest);
  if (base.vaultId !== remote.vaultId)
    throw new Error("Base and remote manifests belong to different vaults");
  const plan: SyncPlan = {
    baseRevision: base.revision,
    remoteRevision: remote.revision,
    uploads: [],
    downloads: [],
    remoteMoves: [],
    localMoves: [],
    conflicts: [],
    tombstonesToCreate: [],
    recoveries: [],
    purges: [],
    warnings: [],
    blockedOperations: input.localSnapshot.blockedPaths.map((blocked) => ({
      code: "PATH_UNSUPPORTED",
      path: blocked.path,
      message: blocked.reasons.join("; "),
      requiresConfirmation: false,
    })),
  };
  if (base.revision > remote.revision) {
    plan.blockedOperations.push({
      code: "BASE_AHEAD_OF_REMOTE",
      message: "Local base revision is newer than the remote manifest; rebuild the local index",
      requiresConfirmation: false,
    });
    return sortPlan(plan);
  }

  const assignment = assignLocalLogicalIds(
    base.entries,
    input.localSnapshot.entries,
    input.pendingLocalEvents,
  );
  for (const path of assignment.ambiguousPaths) {
    plan.warnings.push({
      code: "AMBIGUOUS_RENAME",
      path,
      message: "Rename inference was ambiguous; treating this as create plus delete",
    });
  }
  const ids = new Set([
    ...Object.keys(base.entries),
    ...Object.keys(remote.entries),
    ...Object.keys(remote.tombstones),
    ...Object.keys(assignment.byLogicalId),
  ]);

  for (const logicalId of [...ids].sort()) {
    const baseEntry = base.entries[logicalId];
    const remoteEntry = remote.entries[logicalId];
    const local = assignment.byLogicalId[logicalId];
    const tombstone = remote.tombstones[logicalId];
    if (baseEntry === undefined) {
      planNewObject(plan, logicalId, local, remoteEntry, tombstone, input);
    } else {
      planTrackedObject(plan, logicalId, baseEntry, local, remoteEntry, tombstone, input);
    }
  }

  addCrossLogicalPathCollisions(plan, assignment.byLogicalId, remote.entries, input);
  addMassDeletionGuard(plan, Object.keys(base.entries).length, input);
  return sortPlan(plan);
}

function planNewObject(
  plan: SyncPlan,
  logicalId: string,
  local: LocalFileState | undefined,
  remote: ManifestEntry | undefined,
  tombstone: TombstoneEntry | undefined,
  input: PlanInput,
): void {
  if (tombstone !== undefined) {
    if (local !== undefined) {
      addRecovery(
        plan,
        logicalId,
        local.relativePath,
        "local-to-recovery",
        "Remote tombstone prevents stale resurrection",
      );
    }
    return;
  }
  if (local === undefined && remote === undefined) return;
  if (local !== undefined && remote === undefined) {
    plan.uploads.push({
      operationId: opId("upload-create", logicalId, local.relativePath),
      logicalId,
      path: local.relativePath,
      kind: "create",
      objectType: local.objectType,
      reason: "Local-only creation",
    });
    return;
  }
  if (local === undefined && remote !== undefined) {
    if (remote.objectType === "folder") {
      plan.localMoves.push({
        operationId: opId("local-folder-create", logicalId, remote.relativePath),
        logicalId,
        path: remote.relativePath,
        fromPath: "",
        toPath: remote.relativePath,
        objectType: "folder",
        driveFileId: remote.driveFileId,
        reason: "Remote-only folder creation",
      });
    } else {
      addDownload(plan, logicalId, remote, "create", "Remote-only creation");
    }
    return;
  }
  if (local === undefined || remote === undefined) return;
  if (local.objectType !== remote.objectType) {
    addConflict(
      plan,
      "type-collision",
      logicalId,
      local,
      remote,
      undefined,
      input,
      "Local and remote object types differ",
    );
  } else if (!sameContent(local, remote)) {
    addConflict(
      plan,
      "both-modified",
      logicalId,
      local,
      remote,
      undefined,
      input,
      "Independent creations differ",
    );
  } else if (local.relativePath !== remote.relativePath) {
    addConflict(
      plan,
      "rename-rename",
      logicalId,
      local,
      remote,
      undefined,
      input,
      "Identical new content has different paths",
    );
  }
}

function planTrackedObject(
  plan: SyncPlan,
  logicalId: string,
  base: ManifestEntry,
  local: LocalFileState | undefined,
  remote: ManifestEntry | undefined,
  tombstone: TombstoneEntry | undefined,
  input: PlanInput,
): void {
  const localChange = classifyLocal(base, local);
  const remoteChange = tombstone === undefined ? classifyRemote(base, remote) : "deleted";
  if (localChange === "unchanged" && remoteChange === "unchanged") return;
  if (localChange === "type-changed" || remoteChange === "type-changed") {
    addConflict(
      plan,
      "type-collision",
      logicalId,
      local,
      remote,
      base,
      input,
      "File and folder types collide",
    );
    return;
  }
  if (local === undefined && remote === undefined) return;
  if (local === undefined) {
    if (remoteChange === "unchanged") {
      addLocalDeletion(plan, logicalId, base, input);
    } else if (remote !== undefined) {
      addConflict(
        plan,
        "modify-delete",
        logicalId,
        undefined,
        remote,
        base,
        input,
        "Local delete conflicts with remote change",
      );
    }
    return;
  }
  if (remote === undefined || tombstone !== undefined) {
    if (localChange === "unchanged") {
      addRecovery(
        plan,
        logicalId,
        local.relativePath,
        "local-to-recovery",
        "Remote deletion propagates locally",
        tombstone?.driveFileId,
      );
    } else {
      const kind = localChange === "renamed" ? "rename-delete" : "modify-delete";
      addConflict(
        plan,
        kind,
        logicalId,
        local,
        undefined,
        base,
        input,
        "Local change conflicts with remote deletion",
      );
      addRecovery(
        plan,
        logicalId,
        local.relativePath,
        "local-to-recovery",
        "Preserve local side of delete conflict",
        tombstone?.driveFileId,
      );
    }
    return;
  }

  if (localChange === "unchanged") {
    applyRemoteChange(plan, logicalId, base, local, remote, remoteChange);
    return;
  }
  if (remoteChange === "unchanged") {
    applyLocalChange(plan, logicalId, base, local, remote, localChange);
    return;
  }

  if (sameContent(local, remote)) {
    reconcileIdenticalContent(
      plan,
      logicalId,
      base,
      local,
      remote,
      localChange,
      remoteChange,
      input,
    );
    return;
  }
  const localRenamed = localChange === "renamed" || localChange === "renamed-modified";
  const remoteRenamed = remoteChange === "renamed" || remoteChange === "renamed-modified";
  const kind: ConflictOperation["kind"] =
    localRenamed !== remoteRenamed ? "rename-modify" : "both-modified";
  addConflict(
    plan,
    kind,
    logicalId,
    local,
    remote,
    base,
    input,
    "Local and remote changes diverged",
  );
}

function applyRemoteChange(
  plan: SyncPlan,
  logicalId: string,
  base: ManifestEntry,
  local: LocalFileState,
  remote: ManifestEntry,
  change: ChangeKind,
): void {
  if (change === "renamed" || change === "renamed-modified") {
    plan.localMoves.push(move("local", logicalId, base.relativePath, remote.relativePath, remote));
  }
  if (change === "modified" || change === "renamed-modified") {
    addDownload(plan, logicalId, remote, "update", "Remote-only modification");
  }
  if (
    change === "created" &&
    local.relativePath === remote.relativePath &&
    !sameContent(local, remote)
  ) {
    addDownload(plan, logicalId, remote, "update", "Remote object replaced missing base state");
  }
}

function applyLocalChange(
  plan: SyncPlan,
  logicalId: string,
  base: ManifestEntry,
  local: LocalFileState,
  remote: ManifestEntry,
  change: ChangeKind,
): void {
  if (change === "renamed" || change === "renamed-modified") {
    plan.remoteMoves.push(move("remote", logicalId, base.relativePath, local.relativePath, remote));
  }
  if (change === "modified" || change === "renamed-modified") {
    plan.uploads.push({
      operationId: opId("upload-update", logicalId, local.relativePath),
      logicalId,
      path: local.relativePath,
      kind: "update",
      objectType: local.objectType,
      expectedDriveFileId: remote.driveFileId,
      parentLogicalId: remote.parentLogicalId,
      reason: "Local-only modification",
    });
  }
}

function reconcileIdenticalContent(
  plan: SyncPlan,
  logicalId: string,
  base: ManifestEntry,
  local: LocalFileState,
  remote: ManifestEntry,
  localChange: ChangeKind,
  remoteChange: ChangeKind,
  input: PlanInput,
): void {
  if (local.relativePath === remote.relativePath) return;
  const localRenamed = localChange === "renamed" || localChange === "renamed-modified";
  const remoteRenamed = remoteChange === "renamed" || remoteChange === "renamed-modified";
  if (localRenamed && !remoteRenamed) {
    plan.remoteMoves.push(move("remote", logicalId, base.relativePath, local.relativePath, remote));
  } else if (remoteRenamed && !localRenamed) {
    plan.localMoves.push(move("local", logicalId, base.relativePath, remote.relativePath, remote));
  } else {
    addConflict(
      plan,
      "rename-rename",
      logicalId,
      local,
      remote,
      base,
      input,
      "Both sides renamed to different paths",
    );
  }
}

function addLocalDeletion(
  plan: SyncPlan,
  logicalId: string,
  base: ManifestEntry,
  input: PlanInput,
): void {
  const deletedAt = input.remoteManifest.updatedAt;
  const purgeAfter = new Date(
    Date.parse(deletedAt) + input.policy.recoveryRetentionDays * 86_400_000,
  ).toISOString();
  const tombstone: TombstoneOperation = {
    operationId: opId("tombstone", logicalId, base.relativePath),
    logicalId,
    path: base.relativePath,
    previousPath: base.relativePath,
    driveFileId: base.driveFileId,
    purgeAfter,
    reason: "Local deletion",
  };
  plan.tombstonesToCreate.push(tombstone);
  addRecovery(
    plan,
    logicalId,
    base.relativePath,
    "remote-to-recovery",
    "Remote delete is recoverable",
    base.driveFileId,
  );
}

function addDownload(
  plan: SyncPlan,
  logicalId: string,
  remote: ManifestEntry,
  kind: "create" | "update" | "conflict-copy",
  reason: string,
): void {
  plan.downloads.push({
    operationId: opId(`download-${kind}`, logicalId, remote.relativePath),
    logicalId,
    path: remote.relativePath,
    kind,
    driveFileId: remote.driveFileId,
    contentHash: remote.contentHash,
    sourceModifiedAt: remote.sourceModifiedAt,
    reason,
  });
}

function addConflict(
  plan: SyncPlan,
  kind: ConflictOperation["kind"],
  logicalId: string,
  local: LocalFileState | undefined,
  remote: ManifestEntry | undefined,
  base: ManifestEntry | undefined,
  input: PlanInput,
  reason: string,
): void {
  const path = local?.relativePath ?? remote?.relativePath ?? base?.relativePath ?? "conflict";
  const conflict = conflictPath(
    path,
    logicalId,
    input.policy,
    input.policy.conflictTimestamp ?? input.remoteManifest.updatedAt,
  );
  plan.conflicts.push({
    operationId: opId(`conflict-${kind}`, logicalId, path),
    logicalId,
    path,
    kind,
    localPath: local?.relativePath,
    remotePath: remote?.relativePath,
    basePath: base?.relativePath,
    conflictPath: conflict,
    driveFileId: remote?.driveFileId,
    reason,
  });
  if (remote !== undefined && remote.objectType === "file") {
    plan.remoteMoves.push({
      operationId: opId("remote-conflict-move", logicalId, `${remote.relativePath}->${conflict}`),
      logicalId,
      path: conflict,
      fromPath: remote.relativePath,
      toPath: conflict,
      objectType: "file",
      driveFileId: remote.driveFileId,
      reason: "Move the remote side to a preserved conflict path",
    });
    plan.downloads.push({
      operationId: opId("download-conflict", logicalId, conflict),
      logicalId,
      path: conflict,
      kind: "conflict-copy",
      driveFileId: remote.driveFileId,
      contentHash: remote.contentHash,
      sourceModifiedAt: remote.sourceModifiedAt,
      reason: "Preserve remote conflict version",
    });
  }
  if (local !== undefined && local.objectType === "file") {
    const preservedLogicalId = conflictLogicalId(logicalId, local.relativePath);
    plan.uploads.push({
      operationId: opId("upload-conflict-local", preservedLogicalId, local.relativePath),
      logicalId: preservedLogicalId,
      path: local.relativePath,
      kind: "create",
      objectType: "file",
      reason: "Preserve the local side as an independent manifest object",
    });
  }
  if (local?.objectType === "folder" || remote?.objectType === "folder") {
    plan.blockedOperations.push({
      code: "FOLDER_CONFLICT_REVIEW",
      path,
      message: "Folder or type conflicts require explicit review",
      requiresConfirmation: false,
    });
  }
}

function addRecovery(
  plan: SyncPlan,
  logicalId: string,
  path: string,
  direction: RecoveryOperation["direction"],
  reason: string,
  driveFileId?: string,
): void {
  plan.recoveries.push({
    operationId: opId(`recovery-${direction}`, logicalId, path),
    logicalId,
    path,
    direction,
    driveFileId,
    reason,
  });
}

function move(
  side: "local" | "remote",
  logicalId: string,
  fromPath: string,
  toPath: string,
  remote: ManifestEntry,
) {
  return {
    operationId: opId(`${side}-move`, logicalId, `${fromPath}->${toPath}`),
    logicalId,
    path: toPath,
    fromPath,
    toPath,
    objectType: remote.objectType,
    driveFileId: remote.driveFileId,
    reason: `${side === "local" ? "Remote" : "Local"}-only rename`,
  };
}

function addCrossLogicalPathCollisions(
  plan: SyncPlan,
  local: Record<string, LocalFileState>,
  remote: Record<string, ManifestEntry>,
  input: PlanInput,
): void {
  const remoteByFold = new Map<string, ManifestEntry[]>();
  for (const entry of Object.values(remote)) {
    const folded = validateRelativePath(entry.relativePath).caseFolded;
    const values = remoteByFold.get(folded) ?? [];
    values.push(entry);
    remoteByFold.set(folded, values);
  }
  const existing = new Set(plan.conflicts.map((conflict) => conflict.operationId));
  for (const [logicalId, state] of Object.entries(local)) {
    const folded = validateRelativePath(state.relativePath).caseFolded;
    for (const remoteEntry of remoteByFold.get(folded) ?? []) {
      if (remoteEntry.logicalId === logicalId) continue;
      const operationId = opId("conflict-path-collision", logicalId, state.relativePath);
      if (existing.has(operationId)) continue;
      plan.conflicts.push({
        operationId,
        logicalId,
        path: state.relativePath,
        kind: "path-collision",
        localPath: state.relativePath,
        remotePath: remoteEntry.relativePath,
        conflictPath: conflictPath(
          state.relativePath,
          logicalId,
          input.policy,
          input.policy.conflictTimestamp ?? input.remoteManifest.updatedAt,
        ),
        driveFileId: remoteEntry.driveFileId,
        reason: "Different objects collide on the same cross-platform path",
      });
      plan.blockedOperations.push({
        code: "PATH_COLLISION_REVIEW",
        path: state.relativePath,
        message: "Two different logical objects use the same cross-platform path",
        requiresConfirmation: false,
      });
      existing.add(operationId);
    }
  }
}

function addMassDeletionGuard(plan: SyncPlan, tracked: number, input: PlanInput): void {
  const deleteCount =
    plan.tombstonesToCreate.length +
    plan.recoveries.filter((item) => item.direction === "local-to-recovery").length;
  if (deleteCount === 0 || tracked === 0) return;
  const percentLimit = Math.max(
    1,
    Math.ceil((tracked * input.policy.massDeletionPercentThreshold) / 100),
  );
  const threshold = Math.min(input.policy.massDeletionFileThreshold, percentLimit);
  if (deleteCount > threshold) {
    const blocked: BlockedOperation = {
      code: "MASS_DELETION_BLOCKED",
      message: `${deleteCount} deletions exceed the safety threshold of ${threshold}`,
      requiresConfirmation: true,
    };
    plan.blockedOperations.push(blocked);
  }
}

function opId(kind: string, logicalId: string, path: string): string {
  let hash = 2166136261;
  for (const byte of new TextEncoder().encode(`${kind}\0${logicalId}\0${path}`)) {
    hash ^= byte;
    hash = Math.imul(hash, 16777619);
  }
  return `${kind}:${logicalId}:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function conflictLogicalId(logicalId: string, path: string): string {
  let hash = 2166136261;
  for (const byte of new TextEncoder().encode(`${logicalId}\0${path}\0local-conflict`)) {
    hash ^= byte;
    hash = Math.imul(hash, 16777619);
  }
  return `c_${(hash >>> 0).toString(16).padStart(8, "0")}_${logicalId.slice(-8)}`;
}

function sortPlan(plan: SyncPlan): SyncPlan {
  const byId = <T extends { operationId: string }>(values: T[]): T[] =>
    values.sort((a, b) => a.operationId.localeCompare(b.operationId));
  byId(plan.uploads);
  byId(plan.downloads);
  byId(plan.remoteMoves);
  byId(plan.localMoves);
  byId(plan.conflicts);
  byId(plan.tombstonesToCreate);
  byId(plan.recoveries);
  byId(plan.purges);
  plan.warnings.sort((a, b) =>
    `${a.code}:${a.path ?? ""}`.localeCompare(`${b.code}:${b.path ?? ""}`),
  );
  plan.blockedOperations.sort((a, b) =>
    `${a.code}:${a.path ?? ""}`.localeCompare(`${b.code}:${b.path ?? ""}`),
  );
  return plan;
}
