import { SyncError } from "../types/sync-errors";
import type { ManifestEntry, ObjectType, TombstoneEntry, VaultIdentity } from "../types/domain";
import { assertValidDriveFileId } from "../local/path-validator";
import type { GoogleDriveClient } from "./drive-client";
import type { DriveCreateInput, DriveFile, DriveObject, DriveUpdateInput } from "./drive-types";
import { resumableUpload } from "./resumable-upload";

export interface VaultCapabilityState {
  entries: Record<string, ManifestEntry>;
  tombstones: Record<string, TombstoneEntry>;
  pendingDriveIds: Set<string>;
}

export class VaultDriveClient {
  constructor(
    private readonly drive: GoogleDriveClient,
    readonly vault: VaultIdentity,
    private readonly state: () => VaultCapabilityState,
    private readonly resumableThreshold = 10 * 1024 * 1024,
  ) {}

  async listVaultChildren(parentId: string, signal?: AbortSignal): Promise<DriveFile[]> {
    this.assertAllowedParent(parentId);
    const escapedVaultId = this.vault.shortVaultId.replaceAll("'", "\\'");
    const files = await this.drive.listAllFiles({
      q: `'${parentId}' in parents and trashed = false and appProperties has { key='vaultId' and value='${escapedVaultId}' }`,
      spaces: "drive",
      signal,
    });
    for (const file of files) this.assertProperties(file);
    return files;
  }

  async createVaultFolder(
    parentId: string,
    logicalId: string,
    name: string,
    signal?: AbortSignal,
  ): Promise<DriveFile> {
    this.assertAllowedParent(parentId);
    assertShortId(logicalId);
    const file = await this.drive.createFolder({
      name,
      parentId,
      appProperties: this.properties(logicalId, "folder"),
      signal,
    });
    this.state().pendingDriveIds.add(file.id);
    return file;
  }

  async uploadVaultFile(
    parentId: string,
    logicalId: string,
    input: Omit<DriveCreateInput, "parentId" | "appProperties">,
    signal?: AbortSignal,
  ): Promise<DriveFile> {
    this.assertAllowedParent(parentId);
    assertShortId(logicalId);
    const complete: DriveCreateInput = {
      ...input,
      parentId,
      appProperties: this.properties(logicalId, "file"),
    };
    const file =
      input.content.byteLength >= this.resumableThreshold
        ? await resumableUpload(this.drive, complete, { signal })
        : await this.drive.createFile(complete, signal);
    this.state().pendingDriveIds.add(file.id);
    return file;
  }

  async updateVaultFile(
    logicalId: string,
    fileId: string,
    input: DriveUpdateInput,
    signal?: AbortSignal,
  ): Promise<DriveFile> {
    await this.verifyAllowed(logicalId, fileId, "file", undefined, signal);
    return this.drive.updateFile(fileId, input, signal);
  }

  async downloadVaultFile(
    logicalId: string,
    fileId: string,
    expectedParentId?: string,
    signal?: AbortSignal,
  ): Promise<DriveObject> {
    await this.verifyAllowed(logicalId, fileId, "file", expectedParentId, signal);
    return this.drive.downloadFile(fileId, signal);
  }

  async renameVaultObject(
    logicalId: string,
    fileId: string,
    objectType: ObjectType,
    name: string,
    expectedParentId?: string,
    signal?: AbortSignal,
  ): Promise<DriveFile> {
    await this.verifyAllowed(logicalId, fileId, objectType, expectedParentId, signal);
    return this.drive.updateMetadata(fileId, { name }, {}, signal);
  }

  async moveVaultObject(
    logicalId: string,
    fileId: string,
    objectType: ObjectType,
    fromParentId: string,
    toParentId: string,
    signal?: AbortSignal,
  ): Promise<DriveFile> {
    this.assertAllowedParent(toParentId);
    await this.verifyAllowed(logicalId, fileId, objectType, fromParentId, signal);
    return this.drive.updateMetadata(
      fileId,
      {},
      { addParents: toParentId, removeParents: fromParentId },
      signal,
    );
  }

  async moveVaultFileToRecovery(
    logicalId: string,
    fileId: string,
    fromParentId: string,
    signal?: AbortSignal,
  ): Promise<DriveFile> {
    return this.moveVaultObjectToRecovery(logicalId, fileId, "file", fromParentId, signal);
  }

  async moveVaultObjectToRecovery(
    logicalId: string,
    fileId: string,
    objectType: ObjectType,
    fromParentId: string,
    signal?: AbortSignal,
  ): Promise<DriveFile> {
    return this.moveVaultObject(
      logicalId,
      fileId,
      objectType,
      fromParentId,
      this.vault.recoveryFolderId,
      signal,
    );
  }

  async purgeRecoveredFile(
    logicalId: string,
    fileId: string,
    now = Date.now(),
    signal?: AbortSignal,
  ): Promise<void> {
    const tombstone = this.state().tombstones[logicalId];
    if (
      tombstone === undefined ||
      tombstone.driveFileId !== fileId ||
      Date.parse(tombstone.purgeAfter) > now
    ) {
      throw denied("Recovery retention has not elapsed or tombstone does not match");
    }
    await this.verifyAllowed(logicalId, fileId, "file", this.vault.recoveryFolderId, signal, true);
    await this.drive.permanentlyDelete(fileId, signal);
  }

  private async verifyAllowed(
    logicalId: string,
    fileId: string,
    objectType: ObjectType,
    expectedParentId: string | undefined,
    signal: AbortSignal | undefined,
    allowTombstone = false,
  ): Promise<DriveFile> {
    assertShortId(logicalId);
    assertValidDriveFileId(fileId);
    const state = this.state();
    const entry = state.entries[logicalId];
    const tombstone = state.tombstones[logicalId];
    const allowlisted =
      (entry?.driveFileId === fileId && entry.logicalId === logicalId) ||
      state.pendingDriveIds.has(fileId) ||
      (allowTombstone && tombstone?.driveFileId === fileId);
    if (!allowlisted)
      throw denied("Drive object is not in the active manifest or approved pending set");
    const { file } = await this.drive.getFile(fileId, signal);
    this.assertProperties(file, logicalId, objectType);
    if (expectedParentId !== undefined && !file.parents?.includes(expectedParentId)) {
      throw denied("Drive object parent does not match the manifest");
    }
    return file;
  }

  private assertAllowedParent(parentId: string): void {
    assertValidDriveFileId(parentId);
    const state = this.state();
    const folderIds = new Set([
      this.vault.rootFolderId,
      this.vault.recoveryFolderId,
      ...Object.values(state.entries)
        .filter((entry) => entry.objectType === "folder")
        .map((entry) => entry.driveFileId),
      ...state.pendingDriveIds,
    ]);
    if (!folderIds.has(parentId)) throw denied("Parent is outside the vault capability set");
  }

  private assertProperties(file: DriveFile, logicalId?: string, objectType?: ObjectType): void {
    if (file.appProperties?.vaultId !== this.vault.shortVaultId)
      throw denied("Drive object has the wrong vault ID");
    if (logicalId !== undefined && file.appProperties.logicalId !== logicalId) {
      throw denied("Drive object has the wrong logical ID");
    }
    if (objectType !== undefined && file.appProperties.objectType !== objectType) {
      throw denied("Drive object type does not match");
    }
  }

  private properties(logicalId: string, objectType: ObjectType): Record<string, string> {
    return { vaultId: this.vault.shortVaultId, logicalId, objectType };
  }
}

function assertShortId(value: string): void {
  if (!/^[A-Za-z0-9_-]{6,32}$/u.test(value)) throw denied("Invalid logical ID");
}

function denied(message: string): SyncError {
  return new SyncError("PERMISSION_DENIED", message, {
    retrySafe: false,
    userActionRequired: true,
    resumable: false,
    dataAtRisk: false,
  });
}
