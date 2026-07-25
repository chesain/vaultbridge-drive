import { describe, expect, it } from "vitest";
import { applyConflictResolutions } from "../../src/sync/conflict-resolution";
import { planSync } from "../../src/sync/planner";
import { HASH_A, HASH_B, HASH_C, entry, local, manifest, planInput } from "../fixtures/builders";

function conflictPlan() {
  const base = manifest(1, [entry("note001", "Local.md", HASH_A)]);
  const remote = manifest(2, [entry("note001", "Remote.md", HASH_B)]);
  return planSync(planInput(base, remote, [local("Local.md", HASH_C)]));
}

describe("conflict resolutions", () => {
  it("keep local replaces the tracked remote object", () => {
    const plan = applyConflictResolutions(conflictPlan(), new Map([["note001", "keep-local"]]));
    expect(plan.conflicts).toHaveLength(0);
    expect(plan.uploads).toMatchObject([{ logicalId: "note001", kind: "update" }]);
    expect(plan.downloads).toHaveLength(0);
  });

  it("keep remote stages the remote content and aligns paths", () => {
    const plan = applyConflictResolutions(conflictPlan(), new Map([["note001", "keep-remote"]]));
    expect(plan.conflicts).toHaveLength(0);
    expect(plan.downloads).toMatchObject([
      { logicalId: "note001", path: "Remote.md", kind: "update" },
    ]);
    expect(plan.localMoves).toMatchObject([{ fromPath: "Local.md", toPath: "Remote.md" }]);
  });

  it("keep both retains preservation operations", () => {
    const original = conflictPlan();
    expect(applyConflictResolutions(original, new Map([["note001", "keep-both"]]))).toEqual(
      original,
    );
  });
});
