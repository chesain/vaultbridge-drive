import { describe, expect, it } from "vitest";
import {
  createEmptyManifest,
  parseManifestJson,
  serializeManifest,
  validateManifest,
  verifyManifestChecksum,
} from "../../src/manifest/manifest-schema";
import { migrateManifest } from "../../src/manifest/migrations";
import {
  DEVICE_ID,
  HASH_A,
  VAULT_ID,
  entry,
  folder,
  manifest,
  tombstone,
} from "../fixtures/builders";

describe("manifest schema", () => {
  it("creates a valid empty manifest", () => {
    expect(createEmptyManifest(VAULT_ID, DEVICE_ID).revision).toBe(0);
  });

  it("serializes with and verifies a checksum", async () => {
    const value = manifest(1, [entry("note001", "Note.md")]);
    const parsed = parseManifestJson(await serializeManifest(value));
    expect(parsed.checksum).toMatch(/^[a-f0-9]{64}$/u);
    expect(await verifyManifestChecksum(parsed)).toBe(true);
  });

  it("detects checksum tampering", async () => {
    const parsed = parseManifestJson(
      await serializeManifest(manifest(1, [entry("note001", "Note.md")])),
    );
    parsed.entries.note001!.contentHash = "b".repeat(64);
    expect(await verifyManifestChecksum(parsed)).toBe(false);
  });

  it("rejects traversal", () => {
    expect(() => validateManifest(manifest(1, [entry("note001", "../escape.md")]))).toThrow(
      "Unsafe manifest path",
    );
  });

  it("rejects case-folded duplicate paths", () => {
    expect(() =>
      validateManifest(manifest(1, [entry("note001", "Note.md"), entry("note002", "note.md")])),
    ).toThrow("case-colliding");
  });

  it("rejects duplicate Drive IDs", () => {
    const first = entry("note001", "One.md");
    const second = entry("note002", "Two.md", HASH_A, { driveFileId: first.driveFileId });
    expect(() => validateManifest(manifest(1, [first, second]))).toThrow(
      "Duplicate active Drive file ID",
    );
  });

  it("rejects an active entry and tombstone with the same logical ID", () => {
    expect(() =>
      validateManifest(
        manifest(2, [entry("note001", "Note.md")], [tombstone("note001", "Note.md")]),
      ),
    ).toThrow("both active and tombstoned");
  });

  it("rejects an invalid parent", () => {
    expect(() =>
      validateManifest(
        manifest(1, [entry("note001", "Folder/Note.md", HASH_A, { parentLogicalId: "missing1" })]),
      ),
    ).toThrow("parent is absent");
  });

  it("accepts a valid folder hierarchy", () => {
    expect(
      validateManifest(
        manifest(1, [
          folder("folder01", "Folder"),
          entry("note001", "Folder/Note.md", HASH_A, { parentLogicalId: "folder01" }),
        ]),
      ).entries.note001?.parentLogicalId,
    ).toBe("folder01");
  });

  it("rejects unknown schema versions", () => {
    expect(() => validateManifest({ ...manifest(1), schemaVersion: 99 })).toThrow(
      "schema validation",
    );
  });

  it("migrates the independently defined v0 fixture", () => {
    const legacyEntry: Partial<ReturnType<typeof entry>> = entry("note001", "Note.md");
    delete legacyEntry.remoteRevision;
    const old = {
      schemaVersion: 0,
      vaultId: VAULT_ID,
      revision: 1,
      updatedAt: "2026-07-21T10:00:00.000Z",
      updatedByDeviceId: DEVICE_ID,
      files: {
        note001: legacyEntry,
      },
    };
    expect(migrateManifest(old).entries.note001?.remoteRevision).toBe(1);
  });
});
