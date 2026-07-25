import type { VaultManifest } from "../types/domain";
import { SyncError } from "../types/sync-errors";
import { validateManifest } from "./manifest-schema";

interface LegacyManifestV0 {
  schemaVersion: 0;
  vaultId: string;
  revision: number;
  updatedAt: string;
  updatedByDeviceId: string;
  files: Record<string, Omit<VaultManifest["entries"][string], "remoteRevision">>;
  tombstones?: VaultManifest["tombstones"];
}

export function migrateManifest(value: unknown): VaultManifest {
  if (
    value !== null &&
    typeof value === "object" &&
    (value as { schemaVersion?: unknown }).schemaVersion === 1
  ) {
    return validateManifest(value);
  }
  if (isLegacyV0(value)) {
    return validateManifest({
      schemaVersion: 1,
      vaultId: value.vaultId,
      revision: value.revision,
      updatedAt: value.updatedAt,
      updatedByDeviceId: value.updatedByDeviceId,
      entries: Object.fromEntries(
        Object.entries(value.files).map(([id, entry]) => [
          id,
          { ...entry, remoteRevision: value.revision },
        ]),
      ),
      tombstones: value.tombstones ?? {},
    });
  }
  throw new SyncError("MANIFEST_INVALID", "Unsupported manifest schema version", {
    retrySafe: false,
    userActionRequired: true,
    resumable: false,
    dataAtRisk: true,
  });
}

function isLegacyV0(value: unknown): value is LegacyManifestV0 {
  if (value === null || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return record.schemaVersion === 0 && record.files !== null && typeof record.files === "object";
}
