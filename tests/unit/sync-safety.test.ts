import { describe, expect, it } from "vitest";
import { manifest, planInput, local, entry, tombstone } from "../fixtures/builders";
import { planSync } from "../../src/sync/planner";
import { requiresSafetyPreview } from "../../src/sync/sync-controller";

describe("automatic sync safety preview", () => {
  it("allows ordinary uploads and downloads to run without prompting", () => {
    const upload = planSync(planInput(manifest(0), manifest(0), [local("Local.md")]));
    const download = planSync(
      planInput(manifest(0), manifest(1, [entry("remote01", "Remote.md")]), []),
    );

    expect(requiresSafetyPreview(upload)).toBe(false);
    expect(requiresSafetyPreview(download)).toBe(false);
  });

  it("requires review for deletion and recovery work", () => {
    const base = manifest(1, [entry("note001", "Note.md")]);
    const deletion = planSync(planInput(base, base, []));
    const remoteDeletion = planSync(
      planInput(base, manifest(2, [], [tombstone("note001", "Note.md")]), [local("Note.md")]),
    );

    expect(requiresSafetyPreview(deletion)).toBe(true);
    expect(requiresSafetyPreview(remoteDeletion)).toBe(true);
  });

  it("requires review for conflicts, blocked work, and permanent purges", () => {
    const base = manifest(1, [entry("note001", "Note.md")]);
    const conflict = planSync(
      planInput(base, manifest(2, [entry("note001", "Note.md", "b".repeat(64))]), [
        local("Note.md", "c".repeat(64)),
      ]),
    );
    const purge = structuredClone(planSync(planInput(manifest(0), manifest(0), [])));
    purge.purges.push({
      operationId: "purge:note001",
      logicalId: "note001",
      path: "Note.md",
      reason: "Retention expired",
      driveFileId: "drive_note001_123456",
    });
    const blocked = structuredClone(purge);
    blocked.purges = [];
    blocked.blockedOperations.push({
      code: "PATH_BLOCKED",
      path: "Blocked.md",
      message: "Path requires review",
      requiresConfirmation: true,
    });

    expect(requiresSafetyPreview(conflict)).toBe(true);
    expect(requiresSafetyPreview(purge)).toBe(true);
    expect(requiresSafetyPreview(blocked)).toBe(true);
  });
});
