import { describe, expect, it } from "vitest";
import { isSyncingPhase, syncPhaseLabel } from "../../src/ui/status-bar";

describe("sync status presentation", () => {
  it("marks active synchronization phases for the spinner", () => {
    expect(isSyncingPhase("scanning")).toBe(true);
    expect(isSyncingPhase("downloading")).toBe(true);
    expect(isSyncingPhase("committing")).toBe(true);
  });

  it("shows stable completion and failure states without a spinner", () => {
    expect(syncPhaseLabel("up-to-date")).toBe("Up to date");
    expect(isSyncingPhase("up-to-date")).toBe(false);
    expect(isSyncingPhase("error")).toBe(false);
  });
});
