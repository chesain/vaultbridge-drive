import type { VaultIdentity, VaultManifest } from "../types/domain";
import { SyncError } from "../types/sync-errors";
import type { AppDataStore } from "../drive/appdata-store";
import type { LeaseHandle } from "../drive/lease-manager";
import {
  parseManifestJson,
  serializeManifest,
  validateManifest,
  verifyManifestChecksum,
} from "./manifest-schema";

export interface ManifestRead {
  manifest: VaultManifest;
  etag?: string;
}

export class ManifestStore {
  constructor(private readonly appData: AppDataStore) {}

  async read(vault: VaultIdentity, signal?: AbortSignal): Promise<ManifestRead> {
    const record = await this.appData.get(manifestName(vault.vaultId), signal);
    if (record === null) throw invalid("Remote manifest is missing");
    if (record.file.id !== vault.manifestFileId)
      throw invalid("Registry manifest ID does not match remote record");
    const manifest = parseManifestJson(record.content);
    if (manifest.vaultId !== vault.vaultId)
      throw invalid("Manifest vault ID does not match registry");
    if (!(await verifyManifestChecksum(manifest)))
      throw invalid("Manifest checksum does not match");
    return { manifest, etag: record.etag };
  }

  async commit(
    vault: VaultIdentity,
    expectedRevision: number,
    nextManifest: VaultManifest,
    lease: LeaseHandle,
    signal?: AbortSignal,
  ): Promise<ManifestRead> {
    await lease.assertHeld(signal);
    const current = await this.read(vault, signal);
    if (current.manifest.revision !== expectedRevision) {
      throw new SyncError("REMOTE_CONFLICT", "Remote manifest changed before commit", {
        retrySafe: true,
        userActionRequired: false,
        resumable: true,
        dataAtRisk: false,
        diagnosticContext: { expectedRevision, actualRevision: current.manifest.revision },
      });
    }
    const validated = validateManifest(nextManifest);
    if (
      validated.vaultId !== vault.vaultId ||
      validated.revision !== expectedRevision + 1 ||
      validated.previousRevision !== expectedRevision
    ) {
      throw invalid("Next manifest revision chain is invalid");
    }
    await lease.assertHeld(signal);
    await this.appData.put(manifestName(vault.vaultId), await serializeManifest(validated), signal);
    const committed = await this.read(vault, signal);
    if (
      committed.manifest.revision !== validated.revision ||
      committed.manifest.checksum !== (await parseSerializedChecksum(validated))
    ) {
      throw invalid("Committed manifest could not be verified");
    }
    return committed;
  }
}

export function manifestName(vaultId: string): string {
  return `manifest-${vaultId}.json`;
}

async function parseSerializedChecksum(manifest: VaultManifest): Promise<string | undefined> {
  return parseManifestJson(await serializeManifest(manifest)).checksum;
}

function invalid(message: string): SyncError {
  return new SyncError("MANIFEST_INVALID", message, {
    retrySafe: false,
    userActionRequired: true,
    resumable: false,
    dataAtRisk: true,
  });
}
