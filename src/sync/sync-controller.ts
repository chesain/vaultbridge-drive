import type { CredentialStore } from "../auth/credential-store";
import type { TokenManager } from "../auth/token-manager";
import { AppDataStore } from "../drive/appdata-store";
import { GoogleDriveClient } from "../drive/drive-client";
import { LeaseManager } from "../drive/lease-manager";
import { VaultDriveClient, type VaultCapabilityState } from "../drive/vault-drive-client";
import type { Logger } from "../logging/logger";
import type { EventQueue } from "../local/event-queue";
import type { ObsidianVaultAdapter } from "../local/obsidian-adapter";
import { VaultScanner } from "../local/vault-scanner";
import { createEmptyManifest } from "../manifest/manifest-schema";
import { ManifestStore } from "../manifest/manifest-store";
import type { HttpFetch } from "../net/obsidian-http";
import { VaultRegistryStore } from "../registry/vault-registry";
import type { LocalStateStore } from "../storage/local-state-store";
import type { SettingsStore, VaultBridgeSettings } from "../storage/settings-store";
import type { SyncPhase, VaultIdentity, VaultManifest } from "../types/domain";
import { SyncError, asSyncError } from "../types/sync-errors";
import { fromUtf8, utf8 } from "../utils/encoding";
import { applyConflictResolutions, type ConflictResolution } from "./conflict-resolution";
import { SyncExecutor } from "./executor";
import { planSync } from "./planner";
import type { ConflictOperation, SyncPlan } from "./sync-plan";

export interface SyncControllerHooks {
  onPhase?: (phase: SyncPhase, detail?: string) => void;
  preview?: (plan: SyncPlan) => Promise<{ proceed: boolean; confirmMassDeletion: boolean }>;
  onPlan?: (plan: SyncPlan) => void;
  onCommitted?: (at: string) => void;
}

export interface SyncRunResult {
  plan: SyncPlan;
  committed: boolean;
}

export class SyncController {
  private current: Promise<SyncRunResult> | null = null;
  private queued = false;
  private abortController: AbortController | null = null;
  private lastPlan: SyncPlan | null = null;
  private lastManifest: VaultManifest | null = null;
  private lastVaultDrive: VaultDriveClient | null = null;
  private readonly resolutions = new Map<string, ConflictResolution>();
  private consecutiveFailures = 0;
  private nextAllowedAt = 0;

  constructor(
    private readonly credentials: CredentialStore,
    private readonly tokenManager: TokenManager,
    private readonly local: ObsidianVaultAdapter,
    private readonly settingsStore: SettingsStore,
    private readonly stateStore: LocalStateStore,
    private readonly events: EventQueue,
    private readonly logger: Logger,
    private readonly http: HttpFetch,
    private readonly hooks: SyncControllerHooks = {},
  ) {}

  async sync(options: { previewOnly?: boolean; manual?: boolean } = {}): Promise<SyncRunResult> {
    if (this.current !== null) {
      this.queued = true;
      return this.current;
    }
    if (options.manual !== true && Date.now() < this.nextAllowedAt) {
      throw new SyncError(
        "RATE_LIMITED",
        "Automatic synchronization is backing off after failures",
        {
          retrySafe: true,
          userActionRequired: false,
          resumable: true,
          dataAtRisk: false,
        },
      );
    }
    this.current = this.run(options).finally(() => {
      this.current = null;
      if (this.queued) {
        this.queued = false;
        void this.sync().catch((error: unknown) =>
          this.logger.error("queued_sync_failed", { error }),
        );
      }
    });
    return this.current;
  }

  async syncFresh(
    options: { previewOnly?: boolean; manual?: boolean } = {},
  ): Promise<SyncRunResult> {
    while (this.current !== null) {
      try {
        await this.current;
      } catch {
        // A foreground check still needs a fresh attempt after an earlier run fails.
      }
    }
    return this.sync(options);
  }

  cancel(): void {
    this.abortController?.abort(new Error("Cancelled by user"));
  }

  getLastPlan(): SyncPlan | null {
    return this.lastPlan === null ? null : structuredClone(this.lastPlan);
  }

  getLastManifest(): VaultManifest | null {
    return this.lastManifest === null ? null : structuredClone(this.lastManifest);
  }

  setConflictResolution(logicalId: string, resolution: ConflictResolution): void {
    this.resolutions.set(logicalId, resolution);
  }

  async writeManualMerge(path: string, text: string): Promise<void> {
    const index = path.lastIndexOf("/");
    if (index > 0) {
      const parts = path.slice(0, index).split("/");
      let current = "";
      for (const part of parts) {
        current = current === "" ? part : `${current}/${part}`;
        if (!(await this.local.exists(current))) await this.local.mkdir(current);
      }
    }
    await this.local.writeBinary(path, utf8(text).buffer);
  }

  async loadConflictContent(
    conflict: ConflictOperation,
  ): Promise<{ local?: string; remote?: string; base?: string }> {
    const content: { local?: string; remote?: string; base?: string } = {};
    if (conflict.localPath !== undefined && (await this.local.exists(conflict.localPath))) {
      content.local = fromUtf8(await this.local.readBinary(conflict.localPath));
    }
    if (
      conflict.driveFileId !== undefined &&
      this.lastVaultDrive !== null &&
      this.lastManifest !== null
    ) {
      const entry = this.lastManifest.entries[conflict.logicalId];
      if (entry !== undefined) {
        content.remote = fromUtf8(
          (await this.lastVaultDrive.downloadVaultFile(conflict.logicalId, conflict.driveFileId))
            .content,
        );
      }
    }
    return content;
  }

  async createRemoteVault(displayName: string): Promise<VaultIdentity> {
    await this.credentials.load();
    const drive = new GoogleDriveClient(this.tokenManager, this.logger, this.http);
    const registry = new VaultRegistryStore(new AppDataStore(drive), drive);
    const state = await this.stateStore.load();
    return registry.createVault(displayName, state.deviceId);
  }

  async listRemoteVaults(): Promise<VaultIdentity[]> {
    await this.credentials.load();
    const drive = new GoogleDriveClient(this.tokenManager, this.logger, this.http);
    return (await new VaultRegistryStore(new AppDataStore(drive), drive).load()).vaults;
  }

  private async run(options: { previewOnly?: boolean; manual?: boolean }): Promise<SyncRunResult> {
    this.abortController = new AbortController();
    const signal = this.abortController.signal;
    try {
      const settings = await this.settingsStore.load();
      if (settings.paused && options.manual !== true) throw userAction("Auto-sync is paused");
      if (settings.pauseOnCellular && isCellularConnection()) {
        throw new SyncError(
          "NETWORK_OFFLINE",
          "Synchronization is paused on a detected cellular connection",
          {
            retrySafe: true,
            userActionRequired: false,
            resumable: true,
            dataAtRisk: false,
          },
        );
      }
      if ((await this.credentials.load()) === null) throw userAction("Connect Google Drive first");
      const state = await this.stateStore.load();
      const drive = new GoogleDriveClient(this.tokenManager, this.logger, this.http);
      const appData = new AppDataStore(drive);
      const registry = await new VaultRegistryStore(appData, drive).load(signal);
      const vault = registry.vaults.find((item) => item.vaultId === settings.activeVaultId);
      if (vault === undefined) throw userAction("Select or create a remote vault first");

      this.phase("scanning");
      const scan = await new VaultScanner(this.local, settings, state.localHashes).scan(signal);
      const manifestStore = new ManifestStore(appData);
      const remoteRead = await manifestStore.read(vault, signal);
      this.lastManifest = remoteRead.manifest;
      const base =
        state.baseManifest ?? createEmptyManifest(vault.vaultId, state.deviceId, new Date(0));

      this.phase("planning");
      let plan = planSync({
        baseManifest: base,
        remoteManifest: remoteRead.manifest,
        localSnapshot: scan.snapshot,
        pendingLocalEvents: options.previewOnly === true ? this.events.peek() : this.events.drain(),
        deviceId: state.deviceId,
        policy: policyFrom(settings),
      });
      plan = applyConflictResolutions(plan, this.resolutions);
      this.lastPlan = plan;
      this.hooks.onPlan?.(plan);
      if (options.previewOnly === true) {
        this.phase(plan.conflicts.length > 0 ? "conflict" : "idle");
        return { plan, committed: false };
      }
      if (isNoOp(plan)) {
        state.baseManifest = remoteRead.manifest;
        state.lastCommittedRevision = remoteRead.manifest.revision;
        state.lastLocalScan = scan.snapshot.scannedAt;
        state.localHashes = scan.hashCache;
        await this.stateStore.save(state);
        this.phase("up-to-date");
        this.consecutiveFailures = 0;
        return { plan, committed: false };
      }

      let confirmMassDeletion = false;
      if (requiresSafetyPreview(plan)) {
        const decision = await this.hooks.preview?.(plan);
        if (decision === undefined || !decision.proceed)
          throw cancelled("Synchronization preview was cancelled");
        confirmMassDeletion = decision.confirmMassDeletion;
      }

      const capability: VaultCapabilityState = {
        entries: remoteRead.manifest.entries,
        tombstones: remoteRead.manifest.tombstones,
        pendingDriveIds: new Set(),
      };
      const vaultDrive = new VaultDriveClient(
        drive,
        vault,
        () => capability,
        settings.resumableThresholdMiB * 1024 * 1024,
      );
      this.lastVaultDrive = vaultDrive;
      const executor = new SyncExecutor(
        this.local,
        vaultDrive,
        manifestStore,
        new LeaseManager(appData),
        this.stateStore,
      );
      this.phase("resolving");
      const result = await executor.execute({
        plan,
        remoteManifest: remoteRead.manifest,
        localSnapshot: scan.snapshot,
        vault,
        deviceId: state.deviceId,
        policy: policyFrom(settings),
        signal,
        confirmMassDeletion,
        dryRun: settings.dryRun,
        onPhase: (phase) => this.phase(phase),
      });
      this.lastManifest = result.manifest;
      this.hooks.onCommitted?.(result.history.finishedAt);
      this.resolutions.clear();
      this.phase(plan.conflicts.length > 0 ? "conflict" : "up-to-date");
      this.consecutiveFailures = 0;
      this.nextAllowedAt = 0;
      return { plan, committed: result.committed };
    } catch (error) {
      const syncError = asSyncError(error);
      if (syncError.code === "USER_CANCELLED") this.phase("idle");
      else if (syncError.code === "CREDENTIAL_STORE_LOCKED") this.phase("locked");
      else if (syncError.code === "NETWORK_OFFLINE") this.phase("offline");
      else if (syncError.userActionRequired) this.phase("action-required", syncError.message);
      else this.phase("error", syncError.message);
      this.consecutiveFailures += 1;
      this.nextAllowedAt =
        Date.now() + Math.min(30 * 60_000, 5_000 * 2 ** Math.min(this.consecutiveFailures, 8));
      throw syncError;
    } finally {
      this.abortController = null;
    }
  }

  private phase(phase: SyncPhase, detail?: string): void {
    this.hooks.onPhase?.(phase, detail);
  }
}

export function requiresSafetyPreview(plan: SyncPlan): boolean {
  return (
    plan.tombstonesToCreate.length > 0 ||
    plan.recoveries.length > 0 ||
    plan.purges.length > 0 ||
    plan.conflicts.length > 0 ||
    plan.blockedOperations.length > 0
  );
}

function policyFrom(settings: VaultBridgeSettings) {
  return {
    deviceName: settings.deviceName,
    recoveryRetentionDays: settings.recoveryRetentionDays,
    massDeletionFileThreshold: settings.massDeletionFileThreshold,
    massDeletionPercentThreshold: settings.massDeletionPercentThreshold,
    maxPathLength: 240,
    maxFilenameLength: 180,
  };
}

function isNoOp(plan: SyncPlan): boolean {
  return [
    plan.uploads,
    plan.downloads,
    plan.remoteMoves,
    plan.localMoves,
    plan.conflicts,
    plan.tombstonesToCreate,
    plan.recoveries,
    plan.purges,
    plan.blockedOperations,
  ].every((items) => items.length === 0);
}

function userAction(message: string): SyncError {
  return new SyncError("AUTH_REQUIRED", message, {
    retrySafe: false,
    userActionRequired: true,
    resumable: false,
    dataAtRisk: false,
  });
}

function cancelled(message: string): SyncError {
  return new SyncError("USER_CANCELLED", message, {
    retrySafe: true,
    userActionRequired: false,
    resumable: true,
    dataAtRisk: false,
  });
}

function isCellularConnection(): boolean {
  const connection = (
    navigator as Navigator & { connection?: { type?: string; effectiveType?: string } }
  ).connection;
  return connection?.type === "cellular";
}
