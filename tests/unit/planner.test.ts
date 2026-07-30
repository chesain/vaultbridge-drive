import { describe, expect, it } from "vitest";
import { planSync } from "../../src/sync/planner";
import {
  HASH_A,
  HASH_B,
  HASH_C,
  DEVICE_ID,
  entry,
  folder,
  local,
  manifest,
  planInput,
  policy,
  snapshot,
  tombstone,
} from "../fixtures/builders";

describe("deterministic reconciliation planner", () => {
  it("produces no operations for unchanged state", () => {
    const base = manifest(1, [entry("note001", "Note.md")]);
    const plan = planSync(planInput(base, structuredClone(base), [local("Note.md")]));
    expect(operationCount(plan)).toBe(0);
  });

  it("uploads a local-only creation", () => {
    const empty = manifest(0);
    expect(planSync(planInput(empty, empty, [local("New.md")])).uploads).toHaveLength(1);
  });

  it("downloads a remote-only creation", () => {
    const plan = planSync(planInput(manifest(0), manifest(1, [entry("note001", "New.md")]), []));
    expect(plan.downloads).toMatchObject([{ kind: "create", path: "New.md" }]);
  });

  it("uploads a local-only modification", () => {
    const base = manifest(1, [entry("note001", "Note.md", HASH_A)]);
    const plan = planSync(planInput(base, structuredClone(base), [local("Note.md", HASH_B)]));
    expect(plan.uploads).toMatchObject([{ kind: "update", logicalId: "note001" }]);
  });

  it("downloads a remote-only modification", () => {
    const base = manifest(1, [entry("note001", "Note.md", HASH_A)]);
    const remote = manifest(2, [entry("note001", "Note.md", HASH_B, { remoteRevision: 2 })]);
    const plan = planSync(planInput(base, remote, [local("Note.md", HASH_A)]));
    expect(plan.downloads).toMatchObject([{ kind: "update", logicalId: "note001" }]);
  });

  it("preserves both divergent edits", () => {
    const base = manifest(1, [entry("note001", "Note.md", HASH_A)]);
    const remote = manifest(2, [entry("note001", "Note.md", HASH_B, { remoteRevision: 2 })]);
    const plan = planSync(planInput(base, remote, [local("Note.md", "c".repeat(64))]));
    expect(plan.conflicts).toHaveLength(1);
    expect(plan.downloads.some((operation) => operation.kind === "conflict-copy")).toBe(true);
    expect(
      plan.uploads.some((operation) => operation.reason.includes("Preserve the local side")),
    ).toBe(true);
    expect(plan.conflicts[0]?.conflictPath).toContain("conflict from MacBook 2026-07-21 14-32");
  });

  it("converges identical simultaneous edits", () => {
    const base = manifest(1, [entry("note001", "Note.md", HASH_A)]);
    const remote = manifest(2, [entry("note001", "Note.md", HASH_B, { remoteRevision: 2 })]);
    const plan = planSync(planInput(base, remote, [local("Note.md", HASH_B)]));
    expect(plan.conflicts).toHaveLength(0);
    expect(operationCount(plan)).toBe(0);
  });

  it("propagates a local rename", () => {
    const base = manifest(1, [entry("note001", "Old.md", HASH_A)]);
    const plan = planSync(
      planInput(base, structuredClone(base), [local("New.md", HASH_A)], {
        pendingLocalEvents: [{ type: "rename", oldPath: "Old.md", path: "New.md", at: 1 }],
      }),
    );
    expect(plan.remoteMoves).toMatchObject([{ fromPath: "Old.md", toPath: "New.md" }]);
  });

  it("propagates a remote rename", () => {
    const base = manifest(1, [entry("note001", "Old.md")]);
    const remote = manifest(2, [entry("note001", "New.md", HASH_A, { remoteRevision: 2 })]);
    expect(planSync(planInput(base, remote, [local("Old.md")])).localMoves).toMatchObject([
      { fromPath: "Old.md", toPath: "New.md" },
    ]);
  });

  it("turns a local delete into tombstone and remote recovery", () => {
    const base = manifest(1, [entry("note001", "Note.md")]);
    const plan = planSync(planInput(base, structuredClone(base), []));
    expect(plan.tombstonesToCreate).toHaveLength(1);
    expect(plan.recoveries).toMatchObject([{ direction: "remote-to-recovery" }]);
  });

  it("does not resurrect a tombstoned object", () => {
    const base = manifest(0);
    const remote = manifest(2, [], [tombstone("note001", "Note.md")]);
    const plan = planSync(
      planInput(base, remote, [local("Note.md", HASH_A, { logicalId: "note001" })]),
    );
    expect(plan.uploads.some((operation) => operation.logicalId === "note001")).toBe(false);
    expect(plan.recoveries).toMatchObject([{ direction: "local-to-recovery" }]);
  });

  it("blocks a type collision", () => {
    const base = manifest(1, [entry("object1", "Thing")]);
    const localFolder = local("Thing", HASH_A, {
      objectType: "folder",
      contentHash: undefined,
      byteSize: undefined,
    });
    const plan = planSync(planInput(base, structuredClone(base), [localFolder]));
    expect(plan.conflicts[0]?.kind).toBe("type-collision");
    expect(
      plan.blockedOperations.some((operation) => operation.code === "FOLDER_CONFLICT_REVIEW"),
    ).toBe(true);
  });

  it("blocks case-only path collisions", () => {
    const remote = manifest(1, [entry("note001", "Note.md")]);
    const plan = planSync(planInput(manifest(0), remote, [local("note.md", HASH_B)]));
    expect(plan.conflicts.some((conflict) => conflict.kind === "path-collision")).toBe(true);
    expect(
      plan.blockedOperations.some((operation) => operation.code === "PATH_COLLISION_REVIEW"),
    ).toBe(true);
  });

  it("allows a remote conflict copy to vacate a path before its replacement is downloaded", () => {
    const originalPath = "ToDo/List.md";
    const conflictPath = "ToDo/List (conflict from Other device).md";
    const base = manifest(1, [entry("original01", originalPath, HASH_A)]);
    const remote = manifest(2, [
      entry("original01", conflictPath, HASH_B, { remoteRevision: 2 }),
      entry("preserved01", originalPath, HASH_C, { remoteRevision: 2 }),
    ]);

    const plan = planSync(planInput(base, remote, [local(originalPath, HASH_A)]));

    expect(plan.localMoves).toMatchObject([
      {
        logicalId: "original01",
        fromPath: originalPath,
        toPath: conflictPath,
      },
    ]);
    expect(plan.downloads.map((operation) => operation.path).sort()).toEqual(
      [conflictPath, originalPath].sort(),
    );
    expect(plan.conflicts.some((conflict) => conflict.kind === "path-collision")).toBe(false);
    expect(
      plan.blockedOperations.some((operation) => operation.code === "PATH_COLLISION_REVIEW"),
    ).toBe(false);
  });

  it("keeps remote rename swaps blocked because neither destination is initially vacant", () => {
    const base = manifest(1, [
      entry("first001", "First.md", HASH_A),
      entry("second01", "Second.md", HASH_B),
    ]);
    const remote = manifest(2, [
      entry("first001", "Second.md", HASH_A, { remoteRevision: 2 }),
      entry("second01", "First.md", HASH_B, { remoteRevision: 2 }),
    ]);
    const plan = planSync(
      planInput(base, remote, [local("First.md", HASH_A), local("Second.md", HASH_B)]),
    );

    expect(plan.localMoves).toHaveLength(2);
    expect(plan.conflicts.filter((conflict) => conflict.kind === "path-collision")).toHaveLength(2);
    expect(
      plan.blockedOperations.filter((operation) => operation.code === "PATH_COLLISION_REVIEW"),
    ).toHaveLength(2);
  });

  it("blocks mass deletion using the lower threshold", () => {
    const entries = Array.from({ length: 30 }, (_, index) =>
      entry(`note${String(index).padStart(3, "0")}`, `Note ${index}.md`),
    );
    const base = manifest(1, entries);
    const plan = planSync(planInput(base, structuredClone(base), []));
    expect(plan.blockedOperations).toMatchObject([
      { code: "MASS_DELETION_BLOCKED", requiresConfirmation: true },
    ]);
  });

  it("reports locally blocked paths", () => {
    const input = planInput(manifest(0), manifest(0), []);
    input.localSnapshot = snapshot([]);
    input.localSnapshot.blockedPaths.push({ path: "CON", reasons: ["reserved"] });
    expect(planSync(input).blockedOperations).toMatchObject([
      { code: "PATH_UNSUPPORTED", path: "CON" },
    ]);
  });

  it("plans remote-only folders as local folder creation", () => {
    const remote = manifest(1, [folder("folder01", "Folder")]);
    expect(planSync(planInput(manifest(0), remote, [])).localMoves).toMatchObject([
      { fromPath: "", toPath: "Folder", objectType: "folder" },
    ]);
  });

  it("is byte-for-byte deterministic for the same inputs", () => {
    const base = manifest(1, [entry("note001", "Note.md")]);
    const input = planInput(
      base,
      manifest(2, [entry("note001", "Note.md", HASH_B)]),
      [local("Note.md", "c".repeat(64))],
      {
        deviceId: DEVICE_ID,
        policy,
      },
    );
    expect(JSON.stringify(planSync(input))).toBe(JSON.stringify(planSync(structuredClone(input))));
  });
});

function operationCount(plan: ReturnType<typeof planSync>): number {
  return (
    plan.uploads.length +
    plan.downloads.length +
    plan.remoteMoves.length +
    plan.localMoves.length +
    plan.conflicts.length +
    plan.tombstonesToCreate.length +
    plan.recoveries.length +
    plan.purges.length +
    plan.blockedOperations.length
  );
}
