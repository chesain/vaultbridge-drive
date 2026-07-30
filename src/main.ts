import { Notice, Platform, Plugin } from "obsidian";
import { GoogleClientSecretStore } from "./auth/client-secret-store";
import { EncryptedCredentialStore } from "./auth/encrypted-credential-store";
import { DesktopOAuthService } from "./auth/desktop-oauth";
import { exportPairingBundle, importPairingBundle } from "./auth/pairing";
import { SecretCredentialStore } from "./auth/secret-credential-store";
import { TokenManager } from "./auth/token-manager";
import { registerCommands, type CommandActions } from "./commands/register-commands";
import { GoogleDriveClient } from "./drive/drive-client";
import { EventQueue } from "./local/event-queue";
import { ObsidianVaultAdapter } from "./local/obsidian-adapter";
import { createDiagnostics } from "./logging/diagnostics";
import { Logger } from "./logging/logger";
import { redact } from "./logging/redaction";
import { createObsidianFetch, type HttpFetch } from "./net/obsidian-http";
import { LocalStateStore } from "./storage/local-state-store";
import { PluginCredentialBackend, PluginDataStore } from "./storage/plugin-data-store";
import { SettingsStore } from "./storage/settings-store";
import { AutoSyncScheduler } from "./sync/auto-sync";
import { ForegroundSyncCoordinator } from "./sync/foreground-sync";
import { SyncController } from "./sync/sync-controller";
import type { OAuthCredentials, SyncPhase } from "./types/domain";
import { SyncError } from "./types/sync-errors";
import {
  ConflictCenterModal,
  HistoryModal,
  RecoveryCenterModal,
  previewPlan,
  promptText,
} from "./ui/modals";
import { VaultBridgeSettingsTab, type SettingsActions } from "./ui/settings-tab";
import { VaultBridgeStatusBar } from "./ui/status-bar";
import { SyncActivationModal } from "./ui/sync-activation-modal";
import { SyncActivationShield } from "./ui/sync-activation-shield";

export default class VaultBridgeDrivePlugin extends Plugin {
  private dataStore!: PluginDataStore;
  private settingsStore!: SettingsStore;
  private localStateStore!: LocalStateStore;
  private clientSecretStore!: GoogleClientSecretStore;
  private credentialStore!: SecretCredentialStore;
  private legacyCredentialStore!: EncryptedCredentialStore;
  private tokenManager!: TokenManager;
  private oauth!: DesktopOAuthService;
  private logger!: Logger;
  private controller!: SyncController;
  private scheduler!: AutoSyncScheduler;
  private foregroundSync!: ForegroundSyncCoordinator;
  private events = new EventQueue();
  private status!: VaultBridgeStatusBar;
  private activationGate: SyncActivationModal | SyncActivationShield | null = null;
  private activationCheckInProgress = false;
  private http!: HttpFetch;
  private phase: SyncPhase = "idle";
  private layoutReady = false;

  override async onload(): Promise<void> {
    this.dataStore = new PluginDataStore(this);
    this.settingsStore = new SettingsStore(this.dataStore);
    this.localStateStore = new LocalStateStore(this.dataStore);
    const legacyBackend = new PluginCredentialBackend(this.dataStore);
    this.legacyCredentialStore = new EncryptedCredentialStore(legacyBackend);
    this.clientSecretStore = new GoogleClientSecretStore(this.app.secretStorage);
    this.credentialStore = new SecretCredentialStore(this.app.secretStorage);
    this.http = createObsidianFetch();
    this.tokenManager = new TokenManager(this.credentialStore, this.http);
    const settings = await this.settingsStore.load();
    this.logger = new Logger(settings.logLevel);
    this.oauth = new DesktopOAuthService(this.tokenManager);
    this.status = new VaultBridgeStatusBar([
      Platform.isMobileApp ? this.createMobileStatusIndicator() : this.addStatusBarItem(),
    ]);
    const local = new ObsidianVaultAdapter(this.app.vault);
    this.controller = new SyncController(
      this.credentialStore,
      this.tokenManager,
      local,
      this.settingsStore,
      this.localStateStore,
      this.events,
      this.logger,
      this.http,
      {
        onPhase: (phase, detail) => {
          this.phase = phase;
          this.status.setPhase(phase, detail);
          this.activationGate?.setPhase(phase, detail);
        },
        preview: async (plan) => {
          const restoreActivationGate =
            this.activationCheckInProgress && this.activationGate !== null;
          if (restoreActivationGate) this.releaseActivationGate();
          try {
            return await previewPlan(this.app, plan);
          } finally {
            if (restoreActivationGate && this.activationCheckInProgress && this.layoutReady) {
              this.openActivationGate(this.phase);
            }
          }
        },
        onPlan: (plan) =>
          this.status.setSummary({
            local: plan.uploads.length + plan.remoteMoves.length,
            remote: plan.downloads.length + plan.localMoves.length,
            conflicts: plan.conflicts.length,
            recovery: plan.recoveries.length,
          }),
        onCommitted: (at) => this.status.setSummary({ lastSync: new Date(at).toLocaleString() }),
      },
    );
    this.scheduler = new AutoSyncScheduler(this.controller, (id) => this.registerInterval(id));
    this.scheduler.configure(settings);
    this.foregroundSync = new ForegroundSyncCoordinator(() => this.runActivationSync());

    const actions = this.actions();
    registerCommands(this, actions);
    this.addSettingTab(
      new VaultBridgeSettingsTab(this.app, this, this.settingsStore, this.settingsActions(actions)),
    );
    this.registerVaultEvents();
    this.registerDomEvent(window, "online", () => {
      void this.foregroundSync.checkNow();
    });
    this.registerDomEvent(window, "blur", () => {
      this.foregroundSync.markInactive();
    });
    this.registerDomEvent(window, "focus", () => {
      if (document.visibilityState === "visible") void this.foregroundSync.activate();
    });
    this.registerDomEvent(document, "visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        this.foregroundSync.markInactive();
      } else {
        void this.foregroundSync.activate();
      }
    });
    this.registerDomEvent(window, "beforeunload", () => {
      void this.settingsStore.load().then((current) => {
        if (current.syncOnClose && !current.paused) {
          void this.controller.sync({ manual: true }).catch(() => undefined);
        }
      });
    });

    const hasCredentials = await this.credentialStore.hasCredentials();
    const hasLegacyCredentials = await this.legacyCredentialStore.hasCredentials();
    if (!hasCredentials && hasLegacyCredentials) {
      this.phase = "locked";
      this.status.setPhase("locked", "Complete the one-time Keychain migration");
    }
    const localState = await this.localStateStore.load().catch(() => null);
    const lastSuccess = [...(localState?.history ?? [])]
      .reverse()
      .find((item) => item.outcome === "success");
    if (lastSuccess !== undefined) {
      this.status.setSummary({ lastSync: new Date(lastSuccess.finishedAt).toLocaleString() });
    }
    this.app.workspace.onLayoutReady(() => {
      this.layoutReady = true;
      if (!settings.paused && settings.activeVaultId !== null && hasCredentials) {
        this.openActivationGate("scanning", "Checking Google Drive for changes");
      }
      void this.finishStartup();
    });
  }

  override onunload(): void {
    this.layoutReady = false;
    this.activationCheckInProgress = false;
    this.scheduler.stop();
    this.oauth.cancel();
    this.controller.cancel();
    this.releaseActivationGate();
    void this.legacyCredentialStore.lock();
  }

  private actions(): CommandActions {
    return {
      connect: () => this.connect(false),
      disconnect: () => this.disconnect(),
      sync: () => this.syncNow(),
      preview: () => this.preview(),
      pause: () => this.setPaused(true),
      resume: () => this.setPaused(false),
      history: () => this.openHistory(),
      conflicts: () => this.openConflicts(),
      recovery: () => this.openRecovery(),
      validate: () => this.validateVault(),
      rebuild: () => this.rebuildIndex(),
      exportPairing: () => this.exportPairing(),
      importPairing: () => this.importPairing(),
      reauthenticate: () => this.connect(true),
      forget: () => this.forgetCredentials(),
      cancel: () => {
        this.controller.cancel();
        this.oauth.cancel();
      },
      diagnostics: () => this.copyDiagnostics(),
    };
  }

  private settingsActions(commands: CommandActions): SettingsActions {
    return {
      accountStatus: async () => {
        if (!(await this.credentialStore.hasCredentials())) {
          return (await this.legacyCredentialStore.hasCredentials())
            ? "Credential upgrade required"
            : "Not connected";
        }
        const credentials = await this.loadAccountProfile();
        if (credentials?.accountEmail !== undefined)
          return `Connected as ${credentials.accountEmail}`;
        if (credentials?.accountDisplayName !== undefined)
          return `Connected as ${credentials.accountDisplayName}`;
        return "Connected to Google Drive";
      },
      clientSecretConfigured: () => this.clientSecretStore.has(),
      configureClientSecret: () => this.configureClientSecret(),
      clearClientSecret: () => this.clearClientSecret(),
      connect: commands.connect,
      reauthenticate: commands.reauthenticate,
      disconnect: commands.disconnect,
      forget: commands.forget,
      createVault: () => this.createVault(),
      listVaults: () => this.controller.listRemoteVaults(),
      activeVaultChanged: () => this.foregroundSync.checkNow(),
      sync: commands.sync,
      preview: commands.preview,
      history: commands.history,
      conflicts: commands.conflicts,
      recovery: commands.recovery,
      validateVault: commands.validate,
      rebuildIndex: commands.rebuild,
      exportPairing: commands.exportPairing,
      importPairing: commands.importPairing,
      diagnostics: commands.diagnostics,
      settingsChanged: (settings) => this.scheduler.configure(settings),
    };
  }

  private async finishStartup(): Promise<void> {
    await this.migrateLegacyCredentials();
    await this.foregroundSync.checkNow();
  }

  private registerVaultEvents(): void {
    const handle = async (type: "create" | "modify" | "delete", path: string) => {
      this.events.enqueue({ type, path, at: Date.now() });
      this.scheduler.localChange(await this.settingsStore.load());
    };
    this.registerEvent(this.app.vault.on("create", (file) => void handle("create", file.path)));
    this.registerEvent(this.app.vault.on("modify", (file) => void handle("modify", file.path)));
    this.registerEvent(this.app.vault.on("delete", (file) => void handle("delete", file.path)));
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        this.events.enqueue({ type: "rename", path: file.path, oldPath, at: Date.now() });
        void this.settingsStore.load().then((settings) => this.scheduler.localChange(settings));
      }),
    );
  }

  private async runActivationSync(): Promise<void> {
    if (!this.layoutReady) return;
    this.activationCheckInProgress = true;
    this.openActivationGate("scanning", "Checking Google Drive for changes");
    try {
      const settings = await this.settingsStore.load();
      if (
        settings.paused ||
        settings.activeVaultId === null ||
        !(await this.credentialStore.hasCredentials())
      )
        return;
      await this.controller.syncFresh({ manual: true });
    } catch (error) {
      if (error instanceof SyncError && error.code === "CREDENTIAL_STORE_LOCKED") {
        this.status.setPhase("locked");
      } else if (!(error instanceof SyncError && error.code === "USER_CANCELLED")) {
        this.logger.warn("activation_sync_failed", { error });
        new Notice(
          error instanceof Error
            ? `VaultBridge could not finish the update check: ${error.message}`
            : "VaultBridge could not finish the update check",
          8000,
        );
      }
    } finally {
      this.activationCheckInProgress = false;
      this.releaseActivationGate();
    }
  }

  private async connect(forceConsent: boolean): Promise<void> {
    await this.runAction(async () => {
      if (Platform.isMobileApp)
        throw new Error(
          "Direct OAuth is desktop-only. Import an encrypted pairing bundle on mobile.",
        );
      const settings = await this.settingsStore.load();
      if (settings.googleClientId.length === 0)
        throw new Error("Enter a Google desktop OAuth client ID in settings first.");
      this.phase = "authenticating";
      this.status.setPhase("authenticating");
      const credentials = await this.oauth.connect(
        settings.googleClientId,
        await this.clientSecretStore.load(),
        forceConsent || !(await this.credentialStore.hasCredentials()),
      );
      const updated = await this.loadAccountProfile(credentials);
      if (updated !== null) await this.credentialStore.save(updated);
      if (await this.legacyCredentialStore.hasCredentials())
        await this.legacyCredentialStore.clear();
      const state = await this.localStateStore.load();
      state.authState = "ready";
      await this.localStateStore.save(state);
      this.status.setPhase("idle");
      new Notice(
        updated?.accountEmail === undefined
          ? "VaultBridge connected to Google Drive"
          : `VaultBridge connected as ${updated.accountEmail}`,
      );
    });
  }

  private async disconnect(): Promise<void> {
    await this.runAction(async () => {
      const credentials = await this.credentialStore.load();
      if (credentials === null) return;
      const response = await this.http("https://oauth2.googleapis.com/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: credentials.refreshToken }),
      });
      if (!response.ok)
        throw new Error("Google did not confirm revocation; local credentials were retained.");
      await this.credentialStore.clear();
      await this.clientSecretStore.clear();
      await this.legacyCredentialStore.clear();
      const state = await this.localStateStore.load();
      state.authState = "disconnected";
      await this.localStateStore.save(state);
      this.status.setPhase("idle");
      new Notice("Google access revoked and local credentials forgotten");
    });
  }

  private async forgetCredentials(): Promise<void> {
    await this.credentialStore.clear();
    await this.clientSecretStore.clear();
    await this.legacyCredentialStore.clear();
    const state = await this.localStateStore.load();
    state.authState = "disconnected";
    await this.localStateStore.save(state);
    this.status.setPhase("idle");
    new Notice("Local Keychain credential removed; Google access was not revoked");
  }

  private async syncNow(): Promise<void> {
    await this.runAction(async () => {
      const result = await this.controller.sync({ manual: true });
      new Notice(result.committed ? "VaultBridge sync committed" : "VaultBridge is up to date");
    });
  }

  private async preview(): Promise<void> {
    await this.runAction(async () => {
      const result = await this.controller.sync({ previewOnly: true, manual: true });
      await previewPlan(this.app, result.plan);
    });
  }

  private async createVault(): Promise<void> {
    await this.runAction(async () => {
      const label = await promptText(
        this.app,
        "Create remote VaultBridge vault",
        "Enter a human-readable label. Identity uses a random UUID.",
      );
      if (label === null) return;
      const vault = await this.controller.createRemoteVault(label);
      const settings = await this.settingsStore.load();
      settings.activeVaultId = vault.vaultId;
      settings.vaultDisplayName = vault.displayName;
      await this.settingsStore.save(settings);
      new Notice(`Created remote vault “${vault.displayName}”`);
      await this.foregroundSync.checkNow();
    });
  }

  private async setPaused(paused: boolean): Promise<void> {
    const settings = await this.settingsStore.load();
    settings.paused = paused;
    await this.settingsStore.save(settings);
    this.scheduler.configure(settings);
    new Notice(`VaultBridge auto-sync ${paused ? "paused" : "resumed"}`);
  }

  private async openHistory(): Promise<void> {
    const state = await this.localStateStore.load();
    new HistoryModal(this.app, state.history).open();
  }

  private async openRecovery(): Promise<void> {
    const state = await this.localStateStore.load();
    const items = Object.values(state.baseManifest?.tombstones ?? state.recoveryRecords).sort(
      (a, b) => b.deletedAt.localeCompare(a.deletedAt),
    );
    new RecoveryCenterModal(this.app, items).open();
  }

  private async openConflicts(): Promise<void> {
    const conflicts = this.controller.getLastPlan()?.conflicts ?? [];
    new ConflictCenterModal(this.app, conflicts, {
      load: (conflict) => this.controller.loadConflictContent(conflict),
      resolve: async (conflict, resolution, manualText) => {
        if (
          resolution === "manual" &&
          manualText !== undefined &&
          conflict.localPath !== undefined
        ) {
          await this.controller.writeManualMerge(conflict.localPath, manualText);
        }
        this.controller.setConflictResolution(conflict.logicalId, resolution);
        new Notice(`Conflict resolution set to ${resolution}; run sync to apply it`);
      },
    }).open();
  }

  private async validateVault(): Promise<void> {
    await this.runAction(async () => {
      const result = await this.controller.sync({ previewOnly: true, manual: true });
      if (result.plan.blockedOperations.length > 0) {
        new Notice(
          `Vault validation found ${result.plan.blockedOperations.length} blocked operation(s)`,
        );
      } else {
        new Notice("Vault paths, registry, manifest, and ownership checks passed");
      }
    });
  }

  private async rebuildIndex(): Promise<void> {
    await this.runAction(async () => {
      await this.controller.sync({ previewOnly: true, manual: true });
      await this.localStateStore.rebuild(this.controller.getLastManifest() ?? undefined);
      new Notice("Local sync index rebuilt from the validated remote manifest");
    });
  }

  private async exportPairing(): Promise<void> {
    await this.runAction(async () => {
      const credentials = await this.credentialStore.load();
      if (credentials === null) throw new Error("Connect Google Drive first.");
      const settings = await this.settingsStore.load();
      const vaults = (await this.controller.listRemoteVaults()).filter(
        (vault) => vault.vaultId === settings.activeVaultId,
      );
      if (vaults.length === 0) throw new Error("Select a vault to authorize for pairing.");
      const exported = await exportPairingBundle(credentials, vaults);
      downloadText(`vaultbridge-pairing-${Date.now()}.json`, exported.encryptedBundle);
      await navigator.clipboard.writeText(exported.pairingSecret);
      new Notice(
        `Encrypted bundle downloaded; one-time secret copied. Expires ${new Date(exported.expiresAt).toLocaleTimeString()}. Keep them separate.`,
      );
    });
  }

  private async importPairing(): Promise<void> {
    await this.runAction(async () => {
      const bundle = await promptText(
        this.app,
        "Import pairing bundle",
        "Paste the encrypted bundle JSON. It does not reveal the refresh token.",
      );
      if (bundle === null) return;
      const secret = await promptText(
        this.app,
        "Pairing secret",
        "Paste the one-time pairing secret.",
        true,
      );
      if (secret === null) return;
      const imported = await importPairingBundle(bundle, secret);
      await this.credentialStore.save(imported.credentials);
      if (imported.credentials.clientSecret === undefined) {
        await this.clientSecretStore.clear();
      } else {
        await this.clientSecretStore.save(imported.credentials.clientSecret);
      }
      const settings = await this.settingsStore.load();
      settings.googleClientId = imported.credentials.clientId;
      settings.activeVaultId = imported.vaults[0]?.vaultId ?? null;
      await this.settingsStore.save(settings);
      await this.loadAccountProfile();
      new Notice("Pairing imported and credentials saved in Obsidian Keychain");
      await this.foregroundSync.checkNow();
    });
  }

  private async configureClientSecret(): Promise<void> {
    await this.runAction(async () => {
      const secret = await promptText(
        this.app,
        "Google desktop OAuth client secret",
        "Paste the client secret from this Desktop client. It will be stored only in Obsidian Keychain.",
        true,
      );
      if (secret === null) return;
      await this.clientSecretStore.save(secret);
      const settings = await this.settingsStore.load();
      const credentials = await this.credentialStore.load();
      if (credentials !== null && credentials.clientId === settings.googleClientId) {
        await this.credentialStore.save({ ...credentials, clientSecret: secret.trim() });
      }
      new Notice("Google desktop client secret saved in Obsidian Keychain");
    });
  }

  private async clearClientSecret(): Promise<void> {
    await this.runAction(async () => {
      await this.clientSecretStore.clear();
      const credentials = await this.credentialStore.load();
      if (credentials !== null) {
        const withoutClientSecret = { ...credentials };
        delete withoutClientSecret.clientSecret;
        await this.credentialStore.save(withoutClientSecret);
      }
      new Notice("Google desktop client secret removed from Obsidian Keychain");
    });
  }

  private async migrateLegacyCredentials(): Promise<void> {
    if (await this.credentialStore.hasCredentials()) {
      if (await this.legacyCredentialStore.hasCredentials())
        await this.legacyCredentialStore.clear();
      return;
    }
    if (!(await this.legacyCredentialStore.hasCredentials())) return;
    const passphrase = await promptText(
      this.app,
      "Upgrade VaultBridge credentials",
      "Enter your existing VaultBridge passphrase once. The Google login will move to Obsidian Keychain and future passphrase prompts will be removed.",
      true,
    );
    if (passphrase === null) {
      new Notice("Credential upgrade postponed; reconnect Google Drive to continue", 8000);
      return;
    }
    const unlocked = await this.legacyCredentialStore.unlock(passphrase);
    if (!unlocked) {
      new Notice("Credential upgrade failed: incorrect passphrase", 8000);
      return;
    }
    const credentials = await this.legacyCredentialStore.load();
    if (credentials === null) return;
    await this.credentialStore.save(credentials);
    await this.legacyCredentialStore.clear();
    await this.loadAccountProfile();
    const state = await this.localStateStore.load();
    state.authState = "ready";
    await this.localStateStore.save(state);
    this.status.setPhase("idle");
    new Notice("VaultBridge credentials moved to Obsidian Keychain");
  }

  private async loadAccountProfile(
    credentials?: OAuthCredentials | null,
  ): Promise<OAuthCredentials | null> {
    const current = credentials === undefined ? await this.credentialStore.load() : credentials;
    if (current === null) return null;
    if (current.accountEmail !== undefined && current.accountDisplayName !== undefined)
      return current;
    try {
      const user = await new GoogleDriveClient(
        this.tokenManager,
        this.logger,
        this.http,
      ).getCurrentUser();
      const updated = {
        ...current,
        ...(user.emailAddress === undefined ? {} : { accountEmail: user.emailAddress }),
        ...(user.displayName === undefined ? {} : { accountDisplayName: user.displayName }),
      };
      await this.credentialStore.save(updated);
      return updated;
    } catch {
      return current;
    }
  }

  private async copyDiagnostics(): Promise<void> {
    const state = await this.localStateStore.load();
    const diagnostics = await createDiagnostics({
      pluginVersion: this.manifest.version,
      obsidianVersion: obsidianVersion(),
      platform: `${Platform.isMobileApp ? "mobile" : "desktop"}:${navigator.platform}`,
      phase: this.phase,
      manifestRevision: state.baseManifest?.revision,
      deviceId: state.deviceId,
      plan: this.controller.getLastPlan(),
    });
    await navigator.clipboard.writeText(JSON.stringify(redact(diagnostics), null, 2));
    new Notice("Redacted VaultBridge diagnostics copied; no note contents or credentials included");
  }

  private async runAction(action: () => Promise<void>): Promise<void> {
    try {
      await action();
    } catch (error) {
      this.logger.error("user_action_failed", { error });
      new Notice(error instanceof Error ? error.message : "VaultBridge action failed", 8000);
    }
  }

  private createMobileStatusIndicator(): HTMLElement {
    const element = document.createElement("div");
    element.className = "vaultbridge-status--mobile";
    document.body.appendChild(element);
    this.register(() => element.remove());
    return element;
  }

  private openActivationGate(phase: SyncPhase, detail?: string): void {
    if (this.activationGate !== null) {
      this.activationGate.setPhase(phase, detail);
      return;
    }
    const gate = Platform.isMobileApp
      ? new SyncActivationShield(document)
      : new SyncActivationModal(this.app);
    this.activationGate = gate;
    gate.setPhase(phase, detail);
    gate.open();
  }

  private releaseActivationGate(): void {
    const gate = this.activationGate;
    this.activationGate = null;
    gate?.complete();
  }
}

function downloadText(name: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function obsidianVersion(): string {
  return navigator.userAgent.match(/Obsidian\/([^\s]+)/u)?.[1] ?? "unavailable";
}
