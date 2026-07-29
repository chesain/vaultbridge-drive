import type { SyncPhase } from "../types/domain";

const LABELS: Record<SyncPhase, string> = {
  idle: "Ready",
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

const SYNCING_PHASES = new Set<SyncPhase>([
  "authenticating",
  "scanning",
  "planning",
  "uploading",
  "downloading",
  "resolving",
  "committing",
]);

export function syncPhaseLabel(phase: SyncPhase): string {
  return LABELS[phase];
}

export function isSyncingPhase(phase: SyncPhase): boolean {
  return SYNCING_PHASES.has(phase);
}

export class VaultBridgeStatusBar {
  private phase: SyncPhase = "idle";
  private detail: string | undefined;
  private summary: {
    lastSync?: string;
    local?: number;
    remote?: number;
    conflicts?: number;
    recovery?: number;
  } = {};

  constructor(private readonly elements: HTMLElement[]) {
    for (const element of this.elements) {
      element.classList.add("vaultbridge-status");
      element.setAttribute("role", "status");
      element.setAttribute("aria-live", "polite");
    }
    this.render();
  }

  setPhase(phase: SyncPhase, detail?: string): void {
    this.phase = phase;
    this.detail = detail;
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
    this.render();
  }

  private render(): void {
    const label = LABELS[this.phase];
    const syncing = isSyncingPhase(this.phase);
    const warning =
      this.phase === "conflict" ||
      this.phase === "action-required" ||
      this.phase === "offline" ||
      this.phase === "locked";
    const summary = this.summaryText();
    for (const element of this.elements) {
      element.classList.toggle("vaultbridge-status--syncing", syncing);
      element.classList.toggle("vaultbridge-status--error", this.phase === "error");
      element.classList.toggle("vaultbridge-status--warning", warning);
      element.dataset.phase = this.phase;
      element.setAttribute(
        "aria-label",
        this.detail ?? `VaultBridge Drive: ${syncing ? "Syncing, " : ""}${label}`,
      );
      element.title = [this.detail, summary].filter(Boolean).join(" · ");
      element.replaceChildren();
      const icon = element.ownerDocument.createElement("span");
      icon.className = "vaultbridge-status__icon";
      icon.setAttribute("aria-hidden", "true");
      icon.textContent = syncing
        ? "↻"
        : this.phase === "up-to-date"
          ? "✓"
          : this.phase === "error"
            ? "×"
            : warning
              ? "!"
              : "•";
      const text = element.ownerDocument.createElement("span");
      text.className = "vaultbridge-status__label";
      text.textContent = `VaultBridge: ${label}`;
      element.append(icon, text);
    }
  }

  private summaryText(): string {
    const parts = [
      this.summary.lastSync === undefined ? undefined : `Last: ${this.summary.lastSync}`,
      this.summary.local === undefined ? undefined : `Local: ${this.summary.local}`,
      this.summary.remote === undefined ? undefined : `Remote: ${this.summary.remote}`,
      this.summary.conflicts === undefined ? undefined : `Conflicts: ${this.summary.conflicts}`,
      this.summary.recovery === undefined ? undefined : `Recovery: ${this.summary.recovery}`,
    ].filter((value): value is string => value !== undefined);
    return parts.join(" · ");
  }
}
