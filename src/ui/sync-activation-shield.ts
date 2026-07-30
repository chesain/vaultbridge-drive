import type { SyncPhase } from "../types/domain";
import { syncPhaseLabel } from "./status-bar";

const BLOCKED_EVENTS = [
  "beforeinput",
  "click",
  "compositionstart",
  "cut",
  "drop",
  "keydown",
  "paste",
  "pointerdown",
  "touchstart",
] as const;
const LISTENER_OPTIONS: AddEventListenerOptions = { capture: true, passive: false };

export class SyncActivationShield {
  private element: HTMLElement | null = null;
  private phase: SyncPhase = "scanning";
  private detail: string | undefined;

  constructor(private readonly document: Document) {}

  open(): void {
    if (this.element !== null) return;
    const element = this.document.createElement("div");
    element.className = "vaultbridge-activation-shield";
    element.setAttribute("role", "status");
    element.setAttribute("aria-live", "polite");
    element.setAttribute("aria-busy", "true");
    this.element = element;
    this.renderPhase();
    this.document.body.appendChild(element);
    const active = this.document.activeElement;
    if (active instanceof HTMLElement) active.blur();
    for (const type of BLOCKED_EVENTS) {
      this.document.addEventListener(type, this.blockInteraction, LISTENER_OPTIONS);
    }
  }

  setPhase(phase: SyncPhase, detail?: string): void {
    this.phase = phase;
    this.detail = detail;
    this.renderPhase();
  }

  complete(): void {
    for (const type of BLOCKED_EVENTS) {
      this.document.removeEventListener(type, this.blockInteraction, LISTENER_OPTIONS);
    }
    this.element?.remove();
    this.element = null;
  }

  private readonly blockInteraction = (event: Event): void => {
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  private renderPhase(): void {
    this.element?.setAttribute(
      "aria-label",
      this.detail ?? `VaultBridge Drive: ${syncPhaseLabel(this.phase)}`,
    );
  }
}
