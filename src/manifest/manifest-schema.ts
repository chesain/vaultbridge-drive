import { z } from "zod";
import type { VaultManifest } from "../types/domain";
import { SyncError } from "../types/sync-errors";
import { canonicalJson } from "../utils/canonical-json";
import { sha256 } from "../utils/crypto";
import {
  findPathCollisions,
  isValidDriveFileId,
  validateRelativePath,
} from "../local/path-validator";

export const MANIFEST_SCHEMA_VERSION = 1;
export const MAX_MANIFEST_BYTES = 8 * 1024 * 1024;
export const MAX_MANIFEST_ENTRIES = 50_000;

const shortIdSchema = z.string().regex(/^[A-Za-z0-9_-]{6,32}$/u);
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/u);

const entrySchema = z
  .object({
    logicalId: shortIdSchema,
    driveFileId: z.string().refine(isValidDriveFileId, "Invalid Drive file ID"),
    relativePath: z.string().min(1).max(2048),
    objectType: z.enum(["file", "folder"]),
    contentHash: hashSchema.optional(),
    byteSize: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
    sourceModifiedAt: z.number().finite().nonnegative().optional(),
    remoteRevision: z.number().int().nonnegative(),
    parentLogicalId: shortIdSchema.optional(),
    mimeType: z.string().min(1).max(300).optional(),
  })
  .strict();

const tombstoneSchema = z
  .object({
    logicalId: shortIdSchema,
    previousPath: z.string().min(1).max(2048),
    driveFileId: z.string().refine(isValidDriveFileId, "Invalid Drive file ID").optional(),
    deletedAt: z.string().datetime(),
    deletedByDeviceId: z.string().uuid(),
    deletionRevision: z.number().int().positive(),
    purgeAfter: z.string().datetime(),
  })
  .strict();

export const manifestSchema = z
  .object({
    schemaVersion: z.literal(MANIFEST_SCHEMA_VERSION),
    vaultId: z.string().uuid(),
    revision: z.number().int().nonnegative(),
    previousRevision: z.number().int().nonnegative().optional(),
    updatedAt: z.string().datetime(),
    updatedByDeviceId: z.string().uuid(),
    entries: z.record(shortIdSchema, entrySchema),
    tombstones: z.record(shortIdSchema, tombstoneSchema),
    checksum: hashSchema.optional(),
  })
  .strict();

export function parseManifestJson(raw: string): VaultManifest {
  if (new TextEncoder().encode(raw).byteLength > MAX_MANIFEST_BYTES)
    throw invalid("Manifest exceeds 8 MiB");
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch (error) {
    throw invalid("Manifest is not valid JSON", error);
  }
  return validateManifest(value);
}

export function validateManifest(value: unknown): VaultManifest {
  let manifest: VaultManifest;
  try {
    manifest = manifestSchema.parse(value);
  } catch (error) {
    throw invalid("Manifest schema validation failed", error);
  }
  const entries = Object.entries(manifest.entries);
  const tombstones = Object.entries(manifest.tombstones);
  if (entries.length + tombstones.length > MAX_MANIFEST_ENTRIES)
    throw invalid("Manifest entry limit exceeded");
  const activePaths: string[] = [];
  const driveIds = new Set<string>();
  for (const [key, entry] of entries) {
    if (key !== entry.logicalId) throw invalid("Manifest key and logical ID differ");
    const path = validateRelativePath(entry.relativePath);
    if (!path.valid || path.normalized !== entry.relativePath)
      throw invalid(`Unsafe manifest path: ${entry.relativePath}`);
    if (driveIds.has(entry.driveFileId)) throw invalid("Duplicate active Drive file ID");
    driveIds.add(entry.driveFileId);
    activePaths.push(entry.relativePath);
    if (entry.objectType === "folder" && entry.contentHash !== undefined)
      throw invalid("Folder has a content hash");
    if (
      entry.parentLogicalId !== undefined &&
      manifest.entries[entry.parentLogicalId]?.objectType !== "folder"
    ) {
      throw invalid("Entry parent is absent or is not a folder");
    }
  }
  if (findPathCollisions(activePaths).length > 0)
    throw invalid("Duplicate or case-colliding active paths");
  for (const [key, tombstone] of tombstones) {
    if (key !== tombstone.logicalId) throw invalid("Tombstone key and logical ID differ");
    if (manifest.entries[key] !== undefined)
      throw invalid("Logical ID is both active and tombstoned");
    const path = validateRelativePath(tombstone.previousPath);
    if (!path.valid || path.normalized !== tombstone.previousPath)
      throw invalid("Unsafe tombstone path");
    if (tombstone.deletionRevision > manifest.revision)
      throw invalid("Tombstone revision is in the future");
    if (Date.parse(tombstone.purgeAfter) < Date.parse(tombstone.deletedAt))
      throw invalid("Tombstone purge precedes deletion");
  }
  if (manifest.previousRevision !== undefined && manifest.previousRevision >= manifest.revision) {
    throw invalid("Previous revision must precede current revision");
  }
  return manifest;
}

export async function serializeManifest(manifest: VaultManifest): Promise<string> {
  const validated = validateManifest({ ...manifest, checksum: undefined });
  delete validated.checksum;
  const checksum = await manifestChecksum(validated);
  return canonicalJson({ ...validated, checksum });
}

export async function verifyManifestChecksum(manifest: VaultManifest): Promise<boolean> {
  if (manifest.checksum === undefined) return true;
  const expected = manifest.checksum;
  const copy = structuredClone(manifest);
  delete copy.checksum;
  return (await manifestChecksum(copy)) === expected;
}

export async function manifestChecksum(manifest: VaultManifest): Promise<string> {
  const copy = structuredClone(manifest);
  delete copy.checksum;
  return sha256(canonicalJson(copy));
}

export function createEmptyManifest(
  vaultId: string,
  deviceId: string,
  now = new Date(),
): VaultManifest {
  return validateManifest({
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    vaultId,
    revision: 0,
    updatedAt: now.toISOString(),
    updatedByDeviceId: deviceId,
    entries: {},
    tombstones: {},
  });
}

function invalid(message: string, cause?: unknown): SyncError {
  return new SyncError("MANIFEST_INVALID", message, {
    retrySafe: false,
    userActionRequired: true,
    resumable: false,
    dataAtRisk: true,
    cause,
  });
}
