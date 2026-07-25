import { describe, expect, it } from "vitest";
import {
  assertSafeRelativePath,
  findPathCollisions,
  isValidDriveFileId,
  validateRelativePath,
} from "../../src/local/path-validator";

describe("cross-platform path validation", () => {
  it.each([
    ["Notes/Hello.md", true],
    ["資料/ノート.md", true],
    ["/absolute.md", false],
    ["C:/absolute.md", false],
    ["../escape.md", false],
    ["a/../escape.md", false],
    ["a//b.md", false],
    ["CON", false],
    ["aux.txt", false],
    ["bad:name.md", false],
    ["bad?.md", false],
    ["trailing. ", false],
    ["zero\u0000byte.md", false],
  ])("validates %s", (path, expected) => {
    expect(validateRelativePath(path).valid).toBe(expected);
  });

  it("normalizes path separators but reports noncanonical input", () => {
    expect(validateRelativePath("a\\b.md").normalized).toBe("a/b.md");
  });

  it("detects case-only collisions", () => {
    expect(findPathCollisions(["Note.md", "note.md"])).toHaveLength(1);
  });

  it("enforces path limits", () => {
    expect(validateRelativePath("a".repeat(20), { maxPathLength: 10 }).valid).toBe(false);
    expect(validateRelativePath("a".repeat(20), { maxFilenameLength: 10 }).valid).toBe(false);
  });

  it("throws a typed error for unsafe paths", () => {
    expect(() => assertSafeRelativePath("../../outside")).toThrow("Unsupported path");
  });

  it("validates Drive IDs and allowed aliases", () => {
    expect(isValidDriveFileId("valid_drive_id_123")).toBe(true);
    expect(isValidDriveFileId("root")).toBe(true);
    expect(isValidDriveFileId("appDataFolder")).toBe(true);
    expect(isValidDriveFileId("../../bad")).toBe(false);
    expect(isValidDriveFileId("tiny")).toBe(false);
  });
});
