import { describe, expect, it, vi } from "vitest";
import { ForegroundSyncCoordinator, runForegroundPullCheck } from "../../src/sync/foreground-sync";
import { manifest, planInput, local, entry } from "../fixtures/builders";
import { planSync } from "../../src/sync/planner";
import type { SyncRunResult } from "../../src/sync/sync-controller";

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

describe("foreground pull check", () => {
  it("stops after the background probe when the plan has only outgoing work", async () => {
    const probe: SyncRunResult = {
      plan: planSync(planInput(manifest(0), manifest(0), [local("Local.md")])),
      committed: false,
    };
    const syncFresh = vi.fn(async () => probe);
    const onIncomingRemoteChanges = vi.fn();

    const result = await runForegroundPullCheck(syncFresh, { onIncomingRemoteChanges });

    expect(syncFresh).toHaveBeenCalledOnce();
    expect(syncFresh).toHaveBeenCalledWith({ previewOnly: true, manual: true });
    expect(onIncomingRemoteChanges).not.toHaveBeenCalled();
    expect(result).toEqual({ probe, applied: null });
  });

  it("announces an incoming change before a second fresh scan applies it", async () => {
    const probe: SyncRunResult = {
      plan: planSync(planInput(manifest(0), manifest(1, [entry("remote01", "Remote.md")]), [])),
      committed: false,
    };
    const applied: SyncRunResult = { plan: probe.plan, committed: true };
    const order: string[] = [];
    const syncFresh = vi
      .fn<(options: { previewOnly?: boolean; manual?: boolean }) => Promise<SyncRunResult>>()
      .mockImplementationOnce(async () => {
        order.push("probe");
        return probe;
      })
      .mockImplementationOnce(async () => {
        order.push("apply");
        return applied;
      });

    const result = await runForegroundPullCheck(syncFresh, {
      onIncomingRemoteChanges: () => order.push("popup"),
    });

    expect(syncFresh).toHaveBeenNthCalledWith(1, { previewOnly: true, manual: true });
    expect(syncFresh).toHaveBeenNthCalledWith(2, { manual: true });
    expect(order).toEqual(["probe", "popup", "apply"]);
    expect(result).toEqual({ probe, applied });
  });

  it("does not execute outgoing destructive work during a pull-only probe", async () => {
    const base = manifest(1, [entry("remote01", "Delete.md")]);
    const probe: SyncRunResult = {
      plan: planSync(planInput(base, base, [])),
      committed: false,
    };
    const syncFresh = vi.fn().mockResolvedValueOnce(probe);
    const onIncomingRemoteChanges = vi.fn();

    const result = await runForegroundPullCheck(syncFresh, { onIncomingRemoteChanges });

    expect(syncFresh).toHaveBeenCalledOnce();
    expect(onIncomingRemoteChanges).not.toHaveBeenCalled();
    expect(result.applied).toBeNull();
  });
});
