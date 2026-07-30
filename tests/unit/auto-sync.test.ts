import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SyncController } from "../../src/sync/sync-controller";
import { AutoSyncScheduler } from "../../src/sync/auto-sync";
import { DEFAULT_SETTINGS } from "../../src/storage/settings-store";
import { SyncError } from "../../src/types/sync-errors";

describe("automatic local-change sync", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("window", globalThis);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("runs one second after a local change when configured for the minimum delay", async () => {
    const sync = vi.fn().mockResolvedValue({ committed: false });
    const scheduler = new AutoSyncScheduler({ sync } as unknown as SyncController, (id) => id);
    const settings = {
      ...DEFAULT_SETTINGS,
      autoSyncAfterChanges: true,
      debounceSeconds: 1,
    };

    scheduler.localChange(settings);
    await vi.advanceTimersByTimeAsync(999);
    expect(sync).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(sync).toHaveBeenCalledOnce();
  });

  it("coalesces a burst of edits into one sync after the final change", async () => {
    const sync = vi.fn().mockResolvedValue({ committed: false });
    const scheduler = new AutoSyncScheduler({ sync } as unknown as SyncController, (id) => id);
    const settings = {
      ...DEFAULT_SETTINGS,
      autoSyncAfterChanges: true,
      debounceSeconds: 1,
    };

    scheduler.localChange(settings);
    await vi.advanceTimersByTimeAsync(500);
    scheduler.localChange(settings);
    await vi.advanceTimersByTimeAsync(999);
    expect(sync).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(sync).toHaveBeenCalledOnce();
  });

  it("quietly retries after a source snapshot is superseded by another edit", async () => {
    const localChanged = new SyncError(
      "LOCAL_CHANGED",
      "Local file changed during synchronization: Note.md",
      {
        retrySafe: true,
        userActionRequired: false,
        resumable: true,
        dataAtRisk: false,
      },
    );
    const sync = vi
      .fn()
      .mockRejectedValueOnce(localChanged)
      .mockResolvedValueOnce({ committed: true });
    const scheduler = new AutoSyncScheduler({ sync } as unknown as SyncController, (id) => id);
    const settings = {
      ...DEFAULT_SETTINGS,
      autoSyncAfterChanges: true,
      debounceSeconds: 1,
    };

    scheduler.localChange(settings);
    await vi.advanceTimersByTimeAsync(1000);
    expect(sync).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(1000);
    expect(sync).toHaveBeenCalledTimes(2);
  });
});
