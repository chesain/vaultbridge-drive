import { describe, expect, it, vi } from "vitest";
import { ForegroundSyncCoordinator } from "../../src/sync/foreground-sync";

describe("foreground sync coordinator", () => {
  it("checks once when an inactive app becomes active", async () => {
    const run = vi.fn(async () => undefined);
    const coordinator = new ForegroundSyncCoordinator(run);

    await coordinator.activate();
    expect(run).not.toHaveBeenCalled();

    coordinator.markInactive();
    await Promise.all([coordinator.activate(), coordinator.activate()]);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("can run an explicit startup check while already active", async () => {
    const run = vi.fn(async () => undefined);
    const coordinator = new ForegroundSyncCoordinator(run);

    await coordinator.checkNow();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("queues one fresh check when reactivated during an existing check", async () => {
    let releaseFirst: (() => void) | undefined;
    const first = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const run = vi
      .fn<() => Promise<void>>()
      .mockImplementationOnce(() => first)
      .mockResolvedValue(undefined);
    const coordinator = new ForegroundSyncCoordinator(run);

    const startup = coordinator.checkNow();
    coordinator.markInactive();
    const resumed = coordinator.activate();
    releaseFirst?.();
    await Promise.all([startup, resumed]);

    expect(run).toHaveBeenCalledTimes(2);
  });
});
