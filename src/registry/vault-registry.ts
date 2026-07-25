import { z } from "zod";
import type { VaultIdentity, VaultRegistry } from "../types/domain";
import { SyncError } from "../types/sync-errors";
import { randomId, uuid } from "../utils/crypto";
import type { AppDataStore } from "../drive/appdata-store";
import type { GoogleDriveClient } from "../drive/drive-client";
import { createEmptyManifest, serializeManifest } from "../manifest/manifest-schema";
import { manifestName } from "../manifest/manifest-store";

const REGISTRY_NAME = "vault-registry.json";

const identitySchema = z
  .object({
    vaultId: z.string().uuid(),
    shortVaultId: z.string().regex(/^[A-Za-z0-9_-]{6,32}$/u),
    displayName: z.string().min(1).max(200),
    rootFolderId: z.string().min(10).max(200),
    recoveryFolderId: z.string().min(10).max(200),
    manifestFileId: z.string().min(10).max(200),
    createdAt: z.string().datetime(),
    schemaVersion: z.literal(1),
  })
  .strict();

const registrySchema = z
  .object({
    schemaVersion: z.literal(1),
    updatedAt: z.string().datetime(),
    vaults: z.array(identitySchema).max(500),
  })
  .strict();

export class VaultRegistryStore {
  constructor(
    private readonly appData: AppDataStore,
    private readonly drive: GoogleDriveClient,
  ) {}

  async load(signal?: AbortSignal): Promise<VaultRegistry> {
    const record = await this.appData.get(REGISTRY_NAME, signal);
    if (record === null) {
      return { schemaVersion: 1, updatedAt: new Date(0).toISOString(), vaults: [] };
    }
    try {
      const registry = registrySchema.parse(JSON.parse(record.content) as unknown);
      assertRegistryUnique(registry);
      return registry;
    } catch (error) {
      throw new SyncError("MANIFEST_INVALID", "Vault registry is invalid", {
        retrySafe: false,
        userActionRequired: true,
        resumable: false,
        dataAtRisk: true,
        cause: error,
      });
    }
  }

  async save(registry: VaultRegistry, signal?: AbortSignal): Promise<void> {
    const validated = registrySchema.parse(registry);
    assertRegistryUnique(validated);
    await this.appData.put(REGISTRY_NAME, JSON.stringify(validated), signal);
  }

  async createVault(
    displayName: string,
    deviceId: string,
    signal?: AbortSignal,
  ): Promise<VaultIdentity> {
    const label = displayName.trim();
    if (
      label.length < 1 ||
      label.length > 150 ||
      label.includes("/") ||
      label.includes("\\") ||
      hasControlCharacter(label)
    ) {
      throw new SyncError(
        "PATH_UNSUPPORTED",
        "Vault display name contains unsupported characters",
        {
          retrySafe: true,
          userActionRequired: true,
          resumable: false,
          dataAtRisk: false,
        },
      );
    }
    const registry = await this.load(signal);
    const containerId = await this.ensureContainer(signal);
    const vaultId = uuid();
    const shortVaultId = randomId(8);
    const root = await this.drive.createFolder({
      name: label,
      parentId: containerId,
      appProperties: { vaultId: shortVaultId, logicalId: "vaultroot", objectType: "folder" },
      signal,
    });
    const recovery = await this.drive.createFolder({
      name: ".vaultbridge-recovery",
      parentId: root.id,
      appProperties: { vaultId: shortVaultId, logicalId: "recovery", objectType: "folder" },
      signal,
    });
    const manifestFile = await this.appData.put(
      manifestName(vaultId),
      await serializeManifest(createEmptyManifest(vaultId, deviceId)),
      signal,
    );
    const identity: VaultIdentity = {
      vaultId,
      shortVaultId,
      displayName: label,
      rootFolderId: root.id,
      recoveryFolderId: recovery.id,
      manifestFileId: manifestFile.id,
      createdAt: new Date().toISOString(),
      schemaVersion: 1,
    };
    registry.vaults.push(identity);
    registry.updatedAt = new Date().toISOString();
    await this.save(registry, signal);
    return identity;
  }

  private async ensureContainer(signal?: AbortSignal): Promise<string> {
    const files = await this.drive.listAllFiles({
      spaces: "drive",
      q: "name = 'VaultBridge' and trashed = false and appProperties has { key='objectType' and value='container' }",
      signal,
      maxFiles: 3,
    });
    if (files.length > 1) {
      throw new SyncError("REMOTE_CONFLICT", "Multiple VaultBridge root folders were found", {
        retrySafe: false,
        userActionRequired: true,
        resumable: false,
        dataAtRisk: false,
      });
    }
    if (files[0] !== undefined) return files[0].id;
    const folder = await this.drive.createFolder({
      name: "VaultBridge",
      parentId: "root",
      appProperties: { app: "vaultbridge", objectType: "container" },
      signal,
    });
    return folder.id;
  }
}

function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => character.codePointAt(0)! < 32);
}

function assertRegistryUnique(registry: VaultRegistry): void {
  const fields: Array<
    keyof Pick<VaultIdentity, "vaultId" | "shortVaultId" | "rootFolderId" | "manifestFileId">
  > = ["vaultId", "shortVaultId", "rootFolderId", "manifestFileId"];
  for (const field of fields) {
    const values = registry.vaults.map((vault) => vault[field]);
    if (new Set(values).size !== values.length) throw new Error(`Duplicate registry ${field}`);
  }
}
