import type { SyncController } from "./sync-controller";
import type { VaultBridgeSettings } from "../storage/settings-store";

export class AutoSyncScheduler {
  private debounceTimer: number | null = null;
  private periodicTimer: number | null = null;
  private verificationTimer: number | null = null;

  constructor(
    private readonly controller: SyncController,
    private readonly registerInterval: (id: number) => number,
  ) {}

  configure(settings: VaultBridgeSettings): void {
    this.stop();
    if (settings.periodicSyncMinutes > 0) {
      this.periodicTimer = window.setInterval(() => {
        void this.controller.sync().catch(() => undefined);
      }, settings.periodicSyncMinutes * 60_000);
      this.registerInterval(this.periodicTimer);
    }
    this.verificationTimer = window.setInterval(() => {
      if (!settings.paused) void this.controller.sync().catch(() => undefined);
    }, settings.verificationIntervalMinutes * 60_000);
    this.registerInterval(this.verificationTimer);
  }

  localChange(settings: VaultBridgeSettings): void {
    if (!settings.autoSyncAfterChanges || settings.paused) return;
    if (this.debounceTimer !== null) window.clearTimeout(this.debounceTimer);
    this.debounceTimer = window.setTimeout(() => {
      this.debounceTimer = null;
      void this.controller.sync().catch(() => undefined);
    }, settings.debounceSeconds * 1000);
  }

  stop(): void {
    if (this.debounceTimer !== null) window.clearTimeout(this.debounceTimer);
    if (this.periodicTimer !== null) window.clearInterval(this.periodicTimer);
    if (this.verificationTimer !== null) window.clearInterval(this.verificationTimer);
    this.debounceTimer = null;
    this.periodicTimer = null;
    this.verificationTimer = null;
  }
}
