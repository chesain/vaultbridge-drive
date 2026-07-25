import { z } from "zod";
import type { LogLevel } from "../logging/logger";
import type { PluginDataStore } from "./plugin-data-store";

export interface VaultBridgeSettings {
  googleClientId: string;
  activeVaultId: string | null;
  vaultDisplayName: string;
  deviceName: string;
  autoSyncOnStartup: boolean;
  autoSyncAfterChanges: boolean;
  debounceSeconds: number;
  periodicSyncMinutes: number;
  verificationIntervalMinutes: number;
  syncOnClose: boolean;
  pauseOnCellular: boolean;
  includeNotes: boolean;
  includeAttachments: boolean;
  includeHiddenFiles: boolean;
  includeObsidianConfig: boolean;
  includeThemes: boolean;
  includeCssSnippets: boolean;
  includeCommunityPlugins: boolean;
  includePluginSettings: boolean;
  exclusions: string[];
  previewDestructive: boolean;
  massDeletionFileThreshold: number;
  massDeletionPercentThreshold: number;
  recoveryRetentionDays: number;
  autoPurge: boolean;
  dryRun: boolean;
  maxUploadMiB: number;
  maxTotalSyncMiB: number;
  resumableThresholdMiB: number;
  logLevel: LogLevel;
  paused: boolean;
}

export const DEFAULT_EXCLUSIONS = [
  ".trash/",
  ".git/",
  ".obsidian/cache/",
  ".obsidian/workspace.json",
  ".obsidian/workspace-mobile.json",
  ".obsidian/plugins/vaultbridge-drive/",
];

export const DEFAULT_SETTINGS: VaultBridgeSettings = {
  googleClientId: process.env.VAULTBRIDGE_GOOGLE_CLIENT_ID ?? "",
  activeVaultId: null,
  vaultDisplayName: "",
  deviceName: "This device",
  autoSyncOnStartup: true,
  autoSyncAfterChanges: false,
  debounceSeconds: 30,
  periodicSyncMinutes: 0,
  verificationIntervalMinutes: 360,
  syncOnClose: false,
  pauseOnCellular: false,
  includeNotes: true,
  includeAttachments: true,
  includeHiddenFiles: false,
  includeObsidianConfig: false,
  includeThemes: false,
  includeCssSnippets: false,
  includeCommunityPlugins: false,
  includePluginSettings: false,
  exclusions: [...DEFAULT_EXCLUSIONS],
  previewDestructive: true,
  massDeletionFileThreshold: 20,
  massDeletionPercentThreshold: 10,
  recoveryRetentionDays: 30,
  autoPurge: false,
  dryRun: false,
  maxUploadMiB: 500,
  maxTotalSyncMiB: 2048,
  resumableThresholdMiB: 10,
  logLevel: "info",
  paused: false,
};

const settingsSchema = z
  .object({
    googleClientId: z.string().max(300),
    activeVaultId: z.string().uuid().nullable(),
    vaultDisplayName: z.string().max(200),
    deviceName: z.string().min(1).max(200),
    autoSyncOnStartup: z.boolean(),
    autoSyncAfterChanges: z.boolean(),
    debounceSeconds: z.number().int().min(5).max(3600),
    periodicSyncMinutes: z.number().int().min(0).max(10_080),
    verificationIntervalMinutes: z.number().int().min(5).max(43_200),
    syncOnClose: z.boolean(),
    pauseOnCellular: z.boolean(),
    includeNotes: z.boolean(),
    includeAttachments: z.boolean(),
    includeHiddenFiles: z.boolean(),
    includeObsidianConfig: z.boolean(),
    includeThemes: z.boolean(),
    includeCssSnippets: z.boolean(),
    includeCommunityPlugins: z.boolean(),
    includePluginSettings: z.boolean(),
    exclusions: z.array(z.string().min(1).max(1000)).max(500),
    previewDestructive: z.boolean(),
    massDeletionFileThreshold: z.number().int().min(1).max(100_000),
    massDeletionPercentThreshold: z.number().min(0.1).max(100),
    recoveryRetentionDays: z.number().int().min(1).max(3650),
    autoPurge: z.boolean(),
    dryRun: z.boolean(),
    maxUploadMiB: z.number().int().min(1).max(1_000_000),
    maxTotalSyncMiB: z.number().int().min(1).max(10_000_000),
    resumableThresholdMiB: z.number().int().min(1).max(1024),
    logLevel: z.enum(["error", "warn", "info", "debug", "trace"]),
    paused: z.boolean(),
  })
  .strict();

export class SettingsStore {
  constructor(private readonly data: PluginDataStore) {}

  async load(): Promise<VaultBridgeSettings> {
    const raw = await this.data.get<Record<string, unknown>>("settings");
    const merged = { ...DEFAULT_SETTINGS, ...(raw ?? {}) };
    const parsed = settingsSchema.safeParse(merged);
    return parsed.success ? parsed.data : structuredClone(DEFAULT_SETTINGS);
  }

  async save(settings: VaultBridgeSettings): Promise<void> {
    await this.data.set("settings", settingsSchema.parse(settings));
  }
}
