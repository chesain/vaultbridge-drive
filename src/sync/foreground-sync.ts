export class ForegroundSyncCoordinator {
  private inactive = false;
  private current: Promise<void> | null = null;
  private rerunRequested = false;

  constructor(private readonly run: () => Promise<void>) {}

  markInactive(): void {
    this.inactive = true;
  }

  activate(): Promise<void> {
    if (!this.inactive) return this.current ?? Promise.resolve();
    this.inactive = false;
    return this.request();
  }

  checkNow(): Promise<void> {
    return this.request();
  }

  private request(): Promise<void> {
    if (this.current !== null) {
      this.rerunRequested = true;
      return this.current;
    }
    const run = this.runLoop().finally(() => {
      if (this.current === run) this.current = null;
    });
    this.current = run;
    return run;
  }

  private async runLoop(): Promise<void> {
    do {
      this.rerunRequested = false;
      await this.run();
    } while (this.rerunRequested);
  }
}
