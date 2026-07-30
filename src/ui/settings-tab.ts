import { PluginSettingTab, Setting, type App, type Plugin } from "obsidian";
import type { SettingsStore, VaultBridgeSettings } from "../storage/settings-store";
import type { VaultIdentity } from "../types/domain";

export interface SettingsActions {
  accountStatus(): Promise<string>;
  clientSecretConfigured(): Promise<boolean>;
  configureClientSecret(): Promise<void>;
  clearClientSecret(): Promise<void>;
  connect(): Promise<void>;
  reauthenticate(): Promise<void>;
  disconnect(): Promise<void>;
  forget(): Promise<void>;
  createVault(): Promise<void>;
  listVaults(): Promise<VaultIdentity[]>;
  activeVaultChanged(): Promise<void>;
  sync(): Promise<void>;
  preview(): Promise<void>;
  history(): Promise<void>;
  conflicts(): Promise<void>;
  recovery(): Promise<void>;
  validateVault(): Promise<void>;
  rebuildIndex(): Promise<void>;
  exportPairing(): Promise<void>;
  importPairing(): Promise<void>;
  diagnostics(): Promise<void>;
  settingsChanged(settings: VaultBridgeSettings): void;
}

export class VaultBridgeSettingsTab extends PluginSettingTab {
  constructor(
    app: App,
    plugin: Plugin,
    private readonly store: SettingsStore,
    private readonly actions: SettingsActions,
  ) {
    super(app, plugin);
  }

  override display(): void {
    void this.render();
  }

  private async render(): Promise<void> {
    const { containerEl } = this;
    containerEl.empty();
    const settings = await this.store.load();
    containerEl.createEl("h2", { text: "VaultBridge Drive" });
    containerEl.createEl("p", {
      text: "Unofficial least-privilege Google Drive synchronization. Google can read content stored in Drive; this is not end-to-end encryption.",
    });

    new Setting(containerEl).setName("Account").setHeading();
    new Setting(containerEl)
      .setName("Connection state")
      .setDesc(await this.actions.accountStatus());
    new Setting(containerEl)
      .setName("Google desktop OAuth client ID")
      .setDesc("Personal/development mode.")
      .addText((text) =>
        text
          .setPlaceholder("…apps.googleusercontent.com")
          .setValue(settings.googleClientId)
          .onChange(async (value) => {
            settings.googleClientId = value.trim();
            await this.save(settings);
          }),
      );
    const clientSecretConfigured = await this.actions.clientSecretConfigured();
    const clientSecretSetting = new Setting(containerEl)
      .setName("Google desktop OAuth client secret")
      .setDesc(
        clientSecretConfigured
          ? "Stored in Obsidian Keychain. Some Google desktop credentials require it."
          : "Not configured. Some Google desktop credentials require it for token exchange.",
      )
      .addButton((button) =>
        button
          .setButtonText(clientSecretConfigured ? "Replace secret" : "Set secret")
          .onClick(async () => {
            await this.actions.configureClientSecret();
            await this.render();
          }),
      );
    if (clientSecretConfigured) {
      clientSecretSetting.addButton((button) =>
        button
          .setWarning()
          .setButtonText("Remove secret")
          .onClick(async () => {
            await this.actions.clearClientSecret();
            await this.render();
          }),
      );
    }
    new Setting(containerEl)
      .setName("Account actions")
      .addButton((button) =>
        button
          .setCta()
          .setButtonText("Connect")
          .onClick(async () => {
            await this.actions.connect();
            await this.render();
          }),
      )
      .addButton((button) =>
        button.setButtonText("Reauthenticate").onClick(async () => {
          await this.actions.reauthenticate();
          await this.render();
        }),
      );
    new Setting(containerEl)
      .setName("Disconnect or forget")
      .setDesc(
        "Disconnect revokes access at Google. Forget only removes this device's Keychain credential.",
      )
      .addButton((button) =>
        button
          .setWarning()
          .setButtonText("Disconnect")
          .onClick(async () => {
            await this.actions.disconnect();
            await this.render();
          }),
      )
      .addButton((button) =>
        button
          .setWarning()
          .setButtonText("Forget local credentials")
          .onClick(async () => {
            await this.actions.forget();
            await this.render();
          }),
      );

    new Setting(containerEl).setName("Vault").setHeading();
    const vaults = await this.actions.listVaults().catch(() => []);
    new Setting(containerEl)
      .setName("Remote vault")
      .setDesc("Vault names are labels; permanent identity uses a random UUID.")
      .addDropdown((dropdown) => {
        dropdown.addOption("", "Select a vault");
        for (const vault of vaults)
          dropdown.addOption(vault.vaultId, `${vault.displayName} · ${vault.vaultId.slice(0, 8)}`);
        dropdown.setValue(settings.activeVaultId ?? "").onChange(async (value) => {
          settings.activeVaultId = value === "" ? null : value;
          await this.save(settings);
          await this.actions.activeVaultChanged();
        });
      })
      .addButton((button) =>
        button.setButtonText("Create remote vault").onClick(async () => {
          await this.actions.createVault();
          await this.render();
        }),
      );
    new Setting(containerEl)
      .setName("Device name")
      .setDesc("Used in human-readable conflict filenames.")
      .addText((text) =>
        text.setValue(settings.deviceName).onChange(async (value) => {
          settings.deviceName = value.trim() || "This device";
          await this.save(settings);
        }),
      );

    new Setting(containerEl).setName("Sync").setHeading();
    new Setting(containerEl)
      .setName("Sync controls")
      .addButton((button) =>
        button
          .setCta()
          .setButtonText("Sync now")
          .onClick(() => void this.actions.sync()),
      )
      .addButton((button) =>
        button.setButtonText("Preview").onClick(() => void this.actions.preview()),
      )
      .addButton((button) =>
        button.setButtonText("History").onClick(() => void this.actions.history()),
      );
    new Setting(containerEl)
      .setName("Automatic startup and foreground sync")
      .setDesc(
        "VaultBridge quietly checks for remote updates when Obsidian starts or returns to the foreground. It blocks editing only after incoming changes are found and while a fresh scan applies them; pause auto-sync to disable it.",
      );
    toggle(
      containerEl,
      "Auto-sync after local changes",
      settings.autoSyncAfterChanges,
      async (value) => {
        settings.autoSyncAfterChanges = value;
        await this.save(settings);
      },
    );
    numberSetting(
      containerEl,
      "Change debounce (seconds)",
      settings.debounceSeconds,
      5,
      3600,
      async (value) => {
        settings.debounceSeconds = value;
        await this.save(settings);
      },
    );
    numberSetting(
      containerEl,
      "Periodic sync (minutes; 0 disables)",
      settings.periodicSyncMinutes,
      0,
      10080,
      async (value) => {
        settings.periodicSyncMinutes = value;
        await this.save(settings);
      },
    );
    numberSetting(
      containerEl,
      "Full verification interval (minutes)",
      settings.verificationIntervalMinutes,
      5,
      43200,
      async (value) => {
        settings.verificationIntervalMinutes = value;
        await this.save(settings);
      },
    );
    toggle(containerEl, "Best-effort sync on app close", settings.syncOnClose, async (value) => {
      settings.syncOnClose = value;
      await this.save(settings);
    });
    toggle(
      containerEl,
      "Pause on cellular when detectable",
      settings.pauseOnCellular,
      async (value) => {
        settings.pauseOnCellular = value;
        await this.save(settings);
      },
      "Network type is not exposed on every platform.",
    );
    toggle(containerEl, "Pause auto-sync", settings.paused, async (value) => {
      settings.paused = value;
      await this.save(settings);
    });

    new Setting(containerEl).setName("Content").setHeading();
    toggle(containerEl, "Markdown notes", settings.includeNotes, async (value) => {
      settings.includeNotes = value;
      await this.save(settings);
    });
    toggle(containerEl, "Attachments", settings.includeAttachments, async (value) => {
      settings.includeAttachments = value;
      await this.save(settings);
    });
    toggle(containerEl, "Hidden files", settings.includeHiddenFiles, async (value) => {
      settings.includeHiddenFiles = value;
      await this.save(settings);
    });
    toggle(containerEl, "Obsidian configuration", settings.includeObsidianConfig, async (value) => {
      settings.includeObsidianConfig = value;
      await this.save(settings);
    });
    toggle(containerEl, "Themes", settings.includeThemes, async (value) => {
      settings.includeThemes = value;
      await this.save(settings);
    });
    toggle(containerEl, "CSS snippets", settings.includeCssSnippets, async (value) => {
      settings.includeCssSnippets = value;
      await this.save(settings);
    });
    toggle(
      containerEl,
      "Community plugin binaries",
      settings.includeCommunityPlugins,
      async (value) => {
        settings.includeCommunityPlugins = value;
        await this.save(settings);
      },
      "Third-party plugins may contain executable code.",
    );
    toggle(
      containerEl,
      "Community plugin settings",
      settings.includePluginSettings,
      async (value) => {
        settings.includePluginSettings = value;
        await this.save(settings);
      },
      "Arbitrary plugin data may contain secrets. VaultBridge's own directory is always excluded.",
    );
    new Setting(containerEl)
      .setName("Exclusions")
      .setDesc("One exact path or directory prefix per line.")
      .addTextArea((text) => {
        text.setValue(settings.exclusions.join("\n")).onChange(async (value) => {
          settings.exclusions = value
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean);
          await this.save(settings);
        });
        text.inputEl.rows = 8;
      });

    new Setting(containerEl).setName("Safety").setHeading();
    new Setting(containerEl)
      .setName("Destructive sync review")
      .setDesc(
        "Always required for deletions, recovery moves, conflicts, blocked operations, and permanent purges. Ordinary uploads and downloads run automatically.",
      );
    toggle(containerEl, "Dry-run mode", settings.dryRun, async (value) => {
      settings.dryRun = value;
      await this.save(settings);
    });
    numberSetting(
      containerEl,
      "Mass-deletion file threshold",
      settings.massDeletionFileThreshold,
      1,
      100000,
      async (value) => {
        settings.massDeletionFileThreshold = value;
        await this.save(settings);
      },
    );
    numberSetting(
      containerEl,
      "Mass-deletion percent threshold",
      settings.massDeletionPercentThreshold,
      1,
      100,
      async (value) => {
        settings.massDeletionPercentThreshold = value;
        await this.save(settings);
      },
    );
    numberSetting(
      containerEl,
      "Recovery retention (days)",
      settings.recoveryRetentionDays,
      1,
      3650,
      async (value) => {
        settings.recoveryRetentionDays = value;
        await this.save(settings);
      },
    );
    toggle(
      containerEl,
      "Automatic permanent purge",
      settings.autoPurge,
      async (value) => {
        settings.autoPurge = value;
        await this.save(settings);
      },
      "Off by default. Mass purge still requires confirmation.",
    );
    numberSetting(
      containerEl,
      "Maximum upload (MiB)",
      settings.maxUploadMiB,
      1,
      1000000,
      async (value) => {
        settings.maxUploadMiB = value;
        await this.save(settings);
      },
    );
    numberSetting(
      containerEl,
      "Maximum selected sync size warning (MiB)",
      settings.maxTotalSyncMiB,
      1,
      10000000,
      async (value) => {
        settings.maxTotalSyncMiB = value;
        await this.save(settings);
      },
    );

    new Setting(containerEl).setName("Mobile pairing").setHeading();
    new Setting(containerEl)
      .setName("Encrypted credential transfer")
      .setDesc("Anyone holding both the bundle and one-time secret before expiry can import it.")
      .addButton((button) =>
        button.setButtonText("Export bundle").onClick(() => void this.actions.exportPairing()),
      )
      .addButton((button) =>
        button.setButtonText("Import bundle").onClick(async () => {
          await this.actions.importPairing();
          await this.render();
        }),
      );

    new Setting(containerEl).setName("Advanced").setHeading();
    new Setting(containerEl)
      .setName("Maintenance")
      .addButton((button) =>
        button.setButtonText("Validate vault").onClick(() => void this.actions.validateVault()),
      )
      .addButton((button) =>
        button.setButtonText("Rebuild local index").onClick(() => void this.actions.rebuildIndex()),
      )
      .addButton((button) =>
        button.setButtonText("Conflict Center").onClick(() => void this.actions.conflicts()),
      )
      .addButton((button) =>
        button.setButtonText("Recovery Center").onClick(() => void this.actions.recovery()),
      )
      .addButton((button) =>
        button.setButtonText("Copy diagnostics").onClick(() => void this.actions.diagnostics()),
      );
  }

  private async save(settings: VaultBridgeSettings): Promise<void> {
    await this.store.save(settings);
    this.actions.settingsChanged(settings);
  }
}

function toggle(
  container: HTMLElement,
  name: string,
  value: boolean,
  onChange: (value: boolean) => Promise<void>,
  description?: string,
): void {
  const setting = new Setting(container).setName(name);
  if (description !== undefined) setting.setDesc(description);
  setting.addToggle((component) => component.setValue(value).onChange(onChange));
}

function numberSetting(
  container: HTMLElement,
  name: string,
  value: number,
  min: number,
  max: number,
  onChange: (value: number) => Promise<void>,
): void {
  new Setting(container).setName(name).addText((text) => {
    text.inputEl.type = "number";
    text.inputEl.min = String(min);
    text.inputEl.max = String(max);
    text.setValue(String(value)).onChange(async (raw) => {
      const parsed = Number(raw);
      if (Number.isFinite(parsed)) await onChange(Math.min(max, Math.max(min, Math.round(parsed))));
    });
  });
}
