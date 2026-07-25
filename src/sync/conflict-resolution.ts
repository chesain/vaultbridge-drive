import type { SyncPlan, UploadOperation, DownloadOperation } from "./sync-plan";

export type ConflictResolution = "keep-local" | "keep-remote" | "keep-both" | "manual";

export function applyConflictResolutions(
  plan: SyncPlan,
  resolutions: ReadonlyMap<string, ConflictResolution>,
): SyncPlan {
  const copy = structuredClone(plan);
  for (const conflict of [...copy.conflicts]) {
    const resolution = resolutions.get(conflict.logicalId);
    if (resolution === undefined || resolution === "keep-both") continue;
    if (
      conflict.kind === "path-collision" ||
      conflict.kind === "type-collision" ||
      conflict.localPath === undefined ||
      conflict.driveFileId === undefined
    )
      continue;
    copy.uploads = copy.uploads.filter(
      (operation) =>
        !(
          operation.reason.includes("Preserve the local side") &&
          operation.path === conflict.localPath
        ),
    );
    copy.downloads = copy.downloads.filter(
      (operation) =>
        !(operation.logicalId === conflict.logicalId && operation.kind === "conflict-copy"),
    );
    copy.remoteMoves = copy.remoteMoves.filter(
      (operation) =>
        !(operation.logicalId === conflict.logicalId && operation.reason.includes("conflict path")),
    );
    if (resolution === "keep-local" || resolution === "manual") {
      const upload: UploadOperation = {
        operationId: `resolution-local:${conflict.logicalId}`,
        logicalId: conflict.logicalId,
        path: conflict.localPath,
        kind: "update",
        objectType: "file",
        expectedDriveFileId: conflict.driveFileId,
        reason:
          resolution === "manual" ? "User supplied a manual merge" : "User chose the local version",
      };
      copy.uploads.push(upload);
    } else {
      const path = conflict.remotePath ?? conflict.path;
      if (conflict.localPath !== path) {
        copy.localMoves.push({
          operationId: `resolution-remote-move:${conflict.logicalId}`,
          logicalId: conflict.logicalId,
          path,
          fromPath: conflict.localPath,
          toPath: path,
          objectType: "file",
          driveFileId: conflict.driveFileId,
          reason: "Align the local path with the chosen remote version",
        });
      }
      const download: DownloadOperation = {
        operationId: `resolution-remote:${conflict.logicalId}`,
        logicalId: conflict.logicalId,
        path,
        kind: "update",
        driveFileId: conflict.driveFileId,
        reason: "User chose the remote version",
      };
      copy.downloads.push(download);
    }
    copy.conflicts = copy.conflicts.filter((item) => item.operationId !== conflict.operationId);
  }
  copy.uploads.sort((a, b) => a.operationId.localeCompare(b.operationId));
  copy.downloads.sort((a, b) => a.operationId.localeCompare(b.operationId));
  copy.remoteMoves.sort((a, b) => a.operationId.localeCompare(b.operationId));
  copy.localMoves.sort((a, b) => a.operationId.localeCompare(b.operationId));
  return copy;
}
