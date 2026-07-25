import type { SyncPhase } from "../types/domain";

const LABELS: Record<SyncPhase, string> = {
  idle: "Idle",
  locked: "Locked",
  authenticating: "Authenticating",
  scanning: "Scanning",
  planning: "Planning",
  uploading: "Uploading",
  downloading: "Downloading",
  resolving: "Resolving",
  committing: "Committing",
  "up-to-date": "Up to date",
  conflict: "Conflict detected",
  "action-required": "User action required",
  offline: "Offline",
  error: "Error",
};

export class VaultBridgeStatusBar {
  private phase: SyncPhase = "idle";
  private summary: {
    lastSync?: string;
    local?: number;
    remote?: number;
    conflicts?: number;
    recovery?: number;
  } = {};

  constructor(private readonly element: HTMLElement) {
    this.render();
  }

  setPhase(phase: SyncPhase, detail?: string): void {
    this.phase = phase;
    this.element.classList.toggle("vaultbridge-status--error", phase === "error");
    this.element.classList.toggle(
      "vaultbridge-status--warning",
      phase === "conflict" || phase === "action-required" || phase === "offline",
    );
    this.element.setAttribute("aria-label", detail ?? `VaultBridge Drive: ${LABELS[phase]}`);
    this.render();
  }

  setSummary(input: {
    lastSync?: string;
    local?: number;
    remote?: number;
    conflicts?: number;
    recovery?: number;
  }): void {
    this.summary = { ...this.summary, ...input };
    const parts = [
      this.summary.lastSync === undefined ? undefined : `Last: ${this.summary.lastSync}`,
      this.summary.local === undefined ? undefined : `Local: ${this.summary.local}`,
      this.summary.remote === undefined ? undefined : `Remote: ${this.summary.remote}`,
      this.summary.conflicts === undefined ? undefined : `Conflicts: ${this.summary.conflicts}`,
      this.summary.recovery === undefined ? undefined : `Recovery: ${this.summary.recovery}`,
    ].filter((value): value is string => value !== undefined);
    this.element.title = parts.join(" · ");
  }

  private render(): void {
    this.element.setText(`VaultBridge: ${LABELS[this.phase]}`);
  }
}
