import type { TombstoneEntry, VaultManifest } from "../types/domain";
import { isEligibleForPurge } from "./tombstones";

export class RecoveryService {
  list(manifest: VaultManifest): TombstoneEntry[] {
    return Object.values(manifest.tombstones).sort((a, b) =>
      b.deletedAt.localeCompare(a.deletedAt),
    );
  }

  eligibleForPurge(
    manifest: VaultManifest,
    now = Date.now(),
    acknowledgedRevision?: number,
  ): TombstoneEntry[] {
    return this.list(manifest).filter((item) =>
      isEligibleForPurge(item, now, acknowledgedRevision),
    );
  }

  restore(manifest: VaultManifest, logicalId: string, targetPath?: string): VaultManifest {
    const tombstone = manifest.tombstones[logicalId];
    if (tombstone === undefined || tombstone.driveFileId === undefined)
      throw new Error("Recovery item is unavailable");
    const copy = structuredClone(manifest);
    delete copy.tombstones[logicalId];
    copy.entries[logicalId] = {
      logicalId,
      driveFileId: tombstone.driveFileId,
      relativePath: targetPath ?? tombstone.previousPath,
      objectType: "file",
      remoteRevision: manifest.revision + 1,
    };
    copy.previousRevision = manifest.revision;
    copy.revision += 1;
    delete copy.checksum;
    return copy;
  }
}
