import type { ManifestEntry, TombstoneEntry } from "../types/domain";

export function createTombstone(
  entry: ManifestEntry,
  deviceId: string,
  deletionRevision: number,
  retentionDays: number,
  now = new Date(),
): TombstoneEntry {
  return {
    logicalId: entry.logicalId,
    previousPath: entry.relativePath,
    driveFileId: entry.driveFileId,
    deletedAt: now.toISOString(),
    deletedByDeviceId: deviceId,
    deletionRevision,
    purgeAfter: new Date(now.getTime() + retentionDays * 86_400_000).toISOString(),
  };
}

export function isEligibleForPurge(
  tombstone: TombstoneEntry,
  now = Date.now(),
  acknowledgedRevision?: number,
): boolean {
  return (
    Date.parse(tombstone.purgeAfter) <= now &&
    (acknowledgedRevision === undefined || acknowledgedRevision >= tombstone.deletionRevision)
  );
}
