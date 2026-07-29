import { Modal, type App } from "obsidian";
import type { SyncPhase } from "../types/domain";
import { syncPhaseLabel } from "./status-bar";

export class SyncActivationModal extends Modal {
  private canClose = false;
  private phase: SyncPhase = "scanning";
  private detail: string | undefined;
  private phaseEl: HTMLElement | null = null;

  constructor(app: App) {
    super(app);
  }

  override onOpen(): void {
    this.modalEl.addClass("vaultbridge-activation-modal");
    this.modalEl.setAttribute("aria-busy", "true");
    this.titleEl.setText("VaultBridge is checking for updates");
    const activity = this.contentEl.createDiv({ cls: "vaultbridge-activation-activity" });
    activity.createSpan({
      cls: "vaultbridge-activity-spinner",
      attr: { "aria-hidden": "true" },
    });
    this.phaseEl = activity.createSpan();
    this.contentEl.createEl("p", {
      text: "Editing will resume automatically after remote changes have been checked and applied.",
    });
    this.renderPhase();
  }

  setPhase(phase: SyncPhase, detail?: string): void {
    this.phase = phase;
    this.detail = detail;
    this.renderPhase();
  }

  complete(): void {
    if (this.canClose) return;
    this.canClose = true;
    super.close();
  }

  override close(): void {
    if (this.canClose) super.close();
  }

  override onClose(): void {
    this.modalEl.removeAttribute("aria-busy");
    this.contentEl.empty();
    this.phaseEl = null;
  }

  private renderPhase(): void {
    this.phaseEl?.setText(this.detail ?? syncPhaseLabel(this.phase));
  }
}
