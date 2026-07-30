import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { validateRelativePath } from "../../src/local/path-validator";
import { planSync } from "../../src/sync/planner";
import { validateManifest } from "../../src/manifest/manifest-schema";
import {
  HASH_A,
  HASH_B,
  HASH_C,
  entry,
  local,
  manifest,
  planInput,
  tombstone,
} from "../fixtures/builders";

const safeName = fc
  .array(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789".split("")), {
    minLength: 1,
    maxLength: 20,
  })
  .map((characters) => `${characters.join("")}.md`);

describe("planner properties", () => {
  it("is deterministic", () => {
    fc.assert(
      fc.property(fc.uniqueArray(safeName, { maxLength: 30 }), (paths) => {
        const entries = paths.map((path, index) =>
          entry(`id${String(index).padStart(6, "0")}`, path),
        );
        const base = manifest(1, entries);
        const input = planInput(
          base,
          structuredClone(base),
          paths.map((path) => local(path)),
        );
        expect(planSync(input)).toEqual(planSync(structuredClone(input)));
      }),
      { numRuns: 100 },
    );
  });

  it("unchanged inputs produce no content operations", () => {
    fc.assert(
      fc.property(fc.uniqueArray(safeName, { maxLength: 30 }), (paths) => {
        const entries = paths.map((path, index) =>
          entry(`id${String(index).padStart(6, "0")}`, path),
        );
        const base = manifest(1, entries);
        const plan = planSync(
          planInput(
            base,
            structuredClone(base),
            paths.map((path) => local(path)),
          ),
        );
        expect(plan.uploads).toHaveLength(0);
        expect(plan.downloads).toHaveLength(0);
        expect(plan.conflicts).toHaveLength(0);
        expect(plan.tombstonesToCreate).toHaveLength(0);
      }),
      { numRuns: 100 },
    );
  });

  it("a divergent conflict preserves a local upload and remote download", () => {
    fc.assert(
      fc.property(safeName, (path) => {
        const base = manifest(1, [entry("note001", path, HASH_A)]);
        const remote = manifest(2, [entry("note001", path, HASH_B, { remoteRevision: 2 })]);
        const plan = planSync(planInput(base, remote, [local(path, "c".repeat(64))]));
        expect(
          plan.uploads.some((operation) => operation.reason.includes("Preserve the local side")),
        ).toBe(true);
        expect(plan.downloads.some((operation) => operation.kind === "conflict-copy")).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it("a uniquely vacated file path can receive a different remote logical object", () => {
    fc.assert(
      fc.property(fc.uniqueArray(safeName, { minLength: 2, maxLength: 2 }), ([source, target]) => {
        const base = manifest(1, [entry("original01", source!, HASH_A)]);
        const remote = manifest(2, [
          entry("original01", target!, HASH_B, { remoteRevision: 2 }),
          entry("preserved01", source!, HASH_C, { remoteRevision: 2 }),
        ]);
        const plan = planSync(planInput(base, remote, [local(source!, HASH_A)]));

        expect(plan.localMoves).toMatchObject([
          { logicalId: "original01", fromPath: source, toPath: target },
        ]);
        expect(plan.conflicts.some((conflict) => conflict.kind === "path-collision")).toBe(false);
        expect(
          plan.blockedOperations.some((operation) => operation.code === "PATH_COLLISION_REVIEW"),
        ).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it("rename swaps remain blocked because neither destination is initially vacant", () => {
    fc.assert(
      fc.property(fc.uniqueArray(safeName, { minLength: 2, maxLength: 2 }), ([first, second]) => {
        const base = manifest(1, [
          entry("first001", first!, HASH_A),
          entry("second01", second!, HASH_B),
        ]);
        const remote = manifest(2, [
          entry("first001", second!, HASH_A, { remoteRevision: 2 }),
          entry("second01", first!, HASH_B, { remoteRevision: 2 }),
        ]);
        const plan = planSync(
          planInput(base, remote, [local(first!, HASH_A), local(second!, HASH_B)]),
        );

        expect(
          plan.blockedOperations.filter((operation) => operation.code === "PATH_COLLISION_REVIEW"),
        ).toHaveLength(2);
      }),
      { numRuns: 100 },
    );
  });

  it("a tombstone prevents stale resurrection", () => {
    fc.assert(
      fc.property(safeName, (path) => {
        const remote = manifest(2, [], [tombstone("note001", path)]);
        const plan = planSync(
          planInput(manifest(0), remote, [local(path, HASH_A, { logicalId: "note001" })]),
        );
        expect(plan.uploads.some((operation) => operation.logicalId === "note001")).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it("all planned filesystem paths remain relative and compatible", () => {
    fc.assert(
      fc.property(fc.uniqueArray(safeName, { minLength: 1, maxLength: 20 }), (paths) => {
        const plan = planSync(
          planInput(
            manifest(0),
            manifest(0),
            paths.map((path) => local(path)),
          ),
        );
        for (const operation of [
          ...plan.uploads,
          ...plan.downloads,
          ...plan.localMoves,
          ...plan.remoteMoves,
        ]) {
          expect(validateRelativePath(operation.path).valid).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("manifest validation forbids active/tombstone overlap", () => {
    fc.assert(
      fc.property(safeName, (path) => {
        expect(() =>
          validateManifest(manifest(2, [entry("note001", path)], [tombstone("note001", path)])),
        ).toThrow();
      }),
      { numRuns: 50 },
    );
  });
});
