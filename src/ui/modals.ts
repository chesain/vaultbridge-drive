import { Modal, Notice, Setting, TextAreaComponent, type App } from "obsidian";
import { redact } from "../logging/redaction";
import type { SyncHistoryItem, TombstoneEntry } from "../types/domain";
import { hasHardBlockedOperations, type ConflictOperation, type SyncPlan } from "../sync/sync-plan";
import type { ConflictResolution } from "../sync/conflict-resolution";

export class TextPromptModal extends Modal {
  private value = "";
  private settled = false;

  constructor(
    app: App,
    private readonly titleText: string,
    private readonly description: string,
    private readonly secret: boolean,
    private readonly resolve: (value: string | null) => void,
  ) {
    super(app);
  }

  override onOpen(): void {
    this.titleEl.setText(this.titleText);
    this.contentEl.createEl("p", { text: this.description });
    const input = this.contentEl.createEl("input", { type: this.secret ? "password" : "text" });
    input.addClass("vaultbridge-code");
    input.addEventListener("input", () => (this.value = input.value));
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") this.finish(this.value);
    });
    new Setting(this.contentEl)
      .addButton((button) => button.setButtonText("Cancel").onClick(() => this.finish(null)))
      .addButton((button) =>
        button
          .setCta()
          .setButtonText("Continue")
          .onClick(() => this.finish(this.value)),
      );
    input.focus();
  }

  override onClose(): void {
    this.contentEl.empty();
    if (!this.settled) this.finish(null);
  }

  private finish(value: string | null): void {
    if (this.settled) return;
    this.settled = true;
    this.resolve(value);
    this.close();
  }
}

export function promptText(
  app: App,
  title: string,
  description: string,
  secret = false,
): Promise<string | null> {
  return new Promise((resolve) =>
    new TextPromptModal(app, title, description, secret, resolve).open(),
  );
}

export class SyncPreviewModal extends Modal {
  private settled = false;
  private massConfirmed = false;

  constructor(
    app: App,
    private readonly plan: SyncPlan,
    private readonly resolve: (decision: {
      proceed: boolean;
      confirmMassDeletion: boolean;
    }) => void,
  ) {
    super(app);
  }

  override onOpen(): void {
    this.titleEl.setText("VaultBridge sync preview");
    const groups: Array<[string, Array<{ path?: string; reason?: string; message?: string }>]> = [
      ["Upload", this.plan.uploads],
      ["Download", this.plan.downloads],
      ["Rename", [...this.plan.remoteMoves, ...this.plan.localMoves]],
      ["Conflict", this.plan.conflicts],
      ["Recover", this.plan.recoveries],
      ["Delete", this.plan.tombstonesToCreate],
      ["Purge", this.plan.purges],
      ["Blocked", this.plan.blockedOperations],
      ["Warning", this.plan.warnings],
    ];
    const list = this.contentEl.createDiv({ cls: "vaultbridge-list" });
    for (const [name, operations] of groups) {
      if (operations.length === 0) continue;
      list.createEl("h3", { text: `${name} (${operations.length})` });
      for (const operation of operations.slice(0, 200)) {
        const row = list.createDiv({ cls: "vaultbridge-operation" });
        row.createEl("strong", { text: operation.path ?? "Vault" });
        row.createEl("div", { text: operation.reason ?? operation.message ?? "" });
      }
      if (operations.length > 200) list.createEl("p", { text: `${operations.length - 200} more…` });
    }
    const massBlock = this.plan.blockedOperations.some(
      (operation) => operation.code === "MASS_DELETION_BLOCKED",
    );
    const hardBlock = hasHardBlockedOperations(this.plan);
    if (hardBlock) {
      this.contentEl.createEl("p", {
        cls: "vaultbridge-danger",
        text: "Sync cannot run while hard-blocked paths remain. Cancel, resolve the listed path or type collision, then preview again.",
      });
    }
    if (massBlock) {
      new Setting(this.contentEl)
        .setName("I reviewed and confirm this mass deletion")
        .setDesc("This is never selected automatically. Deleted content is moved to recovery.")
        .addToggle((toggle) => toggle.onChange((value) => (this.massConfirmed = value)));
    }
    new Setting(this.contentEl)
      .addButton((button) =>
        button.setButtonText("Copy redacted JSON").onClick(async () => {
          await navigator.clipboard.writeText(JSON.stringify(redact(this.plan), null, 2));
          new Notice("VaultBridge plan copied");
        }),
      )
      .addButton((button) => button.setButtonText("Cancel").onClick(() => this.finish(false)))
      .addButton((button) => {
        button.setCta().setButtonText(hardBlock ? "Sync blocked" : "Run sync");
        if (hardBlock) {
          button.setDisabled(true);
        } else {
          button.onClick(() => {
            if (massBlock && !this.massConfirmed) {
              new Notice("Confirm the mass-deletion warning first");
              return;
            }
            this.finish(true);
          });
        }
      });
  }

  override onClose(): void {
    this.contentEl.empty();
    if (!this.settled) this.finish(false);
  }

  private finish(proceed: boolean): void {
    if (this.settled) return;
    this.settled = true;
    this.resolve({ proceed, confirmMassDeletion: proceed && this.massConfirmed });
    this.close();
  }
}

export function previewPlan(
  app: App,
  plan: SyncPlan,
): Promise<{ proceed: boolean; confirmMassDeletion: boolean }> {
  return new Promise((resolve) => new SyncPreviewModal(app, plan, resolve).open());
}

export class HistoryModal extends Modal {
  constructor(
    app: App,
    private readonly history: SyncHistoryItem[],
  ) {
    super(app);
  }

  override onOpen(): void {
    this.titleEl.setText("VaultBridge sync history");
    if (this.history.length === 0)
      this.contentEl.createEl("p", { text: "No completed synchronization attempts." });
    for (const item of [...this.history].reverse()) {
      const row = this.contentEl.createDiv({ cls: "vaultbridge-operation" });
      row.createEl("strong", {
        text: `${item.outcome.toLocaleUpperCase()} · ${new Date(item.finishedAt).toLocaleString()}`,
      });
      row.createEl("div", { text: item.message });
      row.createEl("code", { text: JSON.stringify(item.counts) });
    }
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}

export class RecoveryCenterModal extends Modal {
  constructor(
    app: App,
    private readonly items: TombstoneEntry[],
  ) {
    super(app);
  }

  override onOpen(): void {
    this.titleEl.setText("VaultBridge Recovery Center");
    this.contentEl.createEl("p", {
      text: "Recovery items remain protected until their purge date. Automatic purge is off by default.",
    });
    if (this.items.length === 0) this.contentEl.createEl("p", { text: "No recovery items." });
    for (const item of this.items) {
      const row = this.contentEl.createDiv({ cls: "vaultbridge-operation" });
      row.createEl("strong", { text: item.previousPath });
      row.createEl("div", {
        text: `Deleted ${new Date(item.deletedAt).toLocaleString()} · purge eligible ${new Date(item.purgeAfter).toLocaleString()}`,
      });
    }
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}

export interface ConflictCenterActions {
  load(conflict: ConflictOperation): Promise<{ local?: string; remote?: string; base?: string }>;
  resolve(
    conflict: ConflictOperation,
    resolution: ConflictResolution,
    manualText?: string,
  ): Promise<void>;
}

export class ConflictCenterModal extends Modal {
  constructor(
    app: App,
    private readonly conflicts: ConflictOperation[],
    private readonly actions: ConflictCenterActions,
  ) {
    super(app);
  }

  override onOpen(): void {
    this.titleEl.setText("VaultBridge Conflict Center");
    if (this.conflicts.length === 0)
      this.contentEl.createEl("p", { text: "No unresolved conflicts in the latest plan." });
    for (const conflict of this.conflicts) this.renderConflict(conflict);
  }

  override onClose(): void {
    this.contentEl.empty();
  }

  private renderConflict(conflict: ConflictOperation): void {
    const row = this.contentEl.createDiv({ cls: "vaultbridge-operation" });
    row.createEl("h3", { text: conflict.path });
    row.createEl("p", { text: conflict.reason });
    const actions = new Setting(row).addButton((button) =>
      button.setButtonText("Show diff").onClick(async () => {
        const content = await this.actions.load(conflict);
        const pre = row.createEl("pre", { cls: "vaultbridge-code" });
        pre.setText(
          lineDiff(
            content.local ?? "(local unavailable)",
            content.remote ?? "(remote unavailable)",
          ),
        );
        if (content.base === undefined)
          row.createEl("small", {
            text: "Base content is unavailable; hashes still protect change classification.",
          });
      }),
    );
    if (conflict.kind === "path-collision" || conflict.kind === "type-collision") {
      row.createEl("p", {
        cls: "vaultbridge-danger",
        text: "This collision cannot be mediated by choosing a version. Rename one of the colliding paths or correct the file/folder type, then run Preview again.",
      });
      return;
    }
    actions
      .addButton((button) =>
        button
          .setButtonText("Keep local")
          .onClick(() => void this.actions.resolve(conflict, "keep-local")),
      )
      .addButton((button) =>
        button
          .setButtonText("Keep remote")
          .onClick(() => void this.actions.resolve(conflict, "keep-remote")),
      )
      .addButton((button) =>
        button
          .setCta()
          .setButtonText("Keep both")
          .onClick(() => void this.actions.resolve(conflict, "keep-both")),
      )
      .addButton((button) =>
        button.setButtonText("Manual merge").onClick(async () => {
          const content = await this.actions.load(conflict);
          const editor = new TextAreaComponent(row);
          editor.setValue(content.local ?? "");
          editor.inputEl.rows = 16;
          new Setting(row).addButton((save) =>
            save
              .setCta()
              .setButtonText("Use merged text")
              .onClick(() => void this.actions.resolve(conflict, "manual", editor.getValue())),
          );
        }),
      );
  }
}

function lineDiff(local: string, remote: string): string {
  const left = local.split("\n");
  const right = remote.split("\n");
  const lines: string[] = [];
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    if (left[index] === right[index]) lines.push(`  ${left[index] ?? ""}`);
    else {
      if (left[index] !== undefined) lines.push(`- ${left[index]}`);
      if (right[index] !== undefined) lines.push(`+ ${right[index]}`);
    }
  }
  return lines.slice(0, 2000).join("\n");
}
