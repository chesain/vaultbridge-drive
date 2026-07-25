import type { LocalFileState, LocalSnapshot } from "../types/domain";
import { sha256 } from "../utils/crypto";
import { findPathCollisions, validateRelativePath } from "./path-validator";
import type { VaultBridgeSettings } from "../storage/settings-store";

export interface FileStat {
  type: "file" | "folder";
  ctime: number;
  mtime: number;
  size: number;
}

export interface VaultAdapter {
  list(path: string): Promise<{ files: string[]; folders: string[] }>;
  stat(path: string): Promise<FileStat | null>;
  readBinary(path: string): Promise<ArrayBuffer>;
}

export interface HashCacheEntry {
  size: number;
  modifiedAt: number;
  hash: string;
}

export interface ScanResult {
  snapshot: LocalSnapshot;
  hashCache: Record<string, HashCacheEntry>;
  totalBytes: number;
}

export class VaultScanner {
  constructor(
    private readonly adapter: VaultAdapter,
    private readonly settings: VaultBridgeSettings,
    private readonly cache: Record<string, HashCacheEntry>,
  ) {}

  async scan(signal?: AbortSignal): Promise<ScanResult> {
    const entries: Record<string, LocalFileState> = {};
    const blockedPaths: LocalSnapshot["blockedPaths"] = [];
    const nextCache: Record<string, HashCacheEntry> = {};
    const queue = [""];
    let visited = 0;
    let totalBytes = 0;
    while (queue.length > 0) {
      if (signal?.aborted === true) throw signal.reason;
      const folder = queue.shift();
      if (folder === undefined) break;
      const listed = await this.adapter.list(folder);
      for (const path of [...listed.folders].sort()) {
        if (this.isExcluded(path, true)) continue;
        const validation = validateRelativePath(path);
        if (!validation.valid) {
          blockedPaths.push({ path, reasons: validation.reasons });
          continue;
        }
        entries[path] = { relativePath: path, objectType: "folder" };
        queue.push(path);
      }
      for (const path of [...listed.files].sort()) {
        if (this.isExcluded(path, false)) continue;
        const validation = validateRelativePath(path);
        if (!validation.valid) {
          blockedPaths.push({ path, reasons: validation.reasons });
          continue;
        }
        const stat = await this.adapter.stat(path);
        if (stat === null || stat.type !== "file") continue;
        if (stat.size > this.settings.maxUploadMiB * 1024 * 1024) {
          blockedPaths.push({
            path,
            reasons: [`File exceeds ${this.settings.maxUploadMiB} MiB upload limit`],
          });
          continue;
        }
        totalBytes += stat.size;
        const cached = this.cache[path];
        let hash: string;
        if (cached !== undefined && cached.size === stat.size && cached.modifiedAt === stat.mtime) {
          hash = cached.hash;
        } else {
          hash = await sha256(await this.adapter.readBinary(path));
        }
        nextCache[path] = { size: stat.size, modifiedAt: stat.mtime, hash };
        entries[path] = {
          relativePath: path,
          objectType: "file",
          byteSize: stat.size,
          modifiedAt: stat.mtime,
          contentHash: hash,
        };
        visited += 1;
        if (visited % 100 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
    }
    for (const collision of findPathCollisions(Object.keys(entries))) {
      for (const path of collision.paths) blockedPaths.push({ path, reasons: [collision.reason] });
    }
    if (totalBytes > this.settings.maxTotalSyncMiB * 1024 * 1024) {
      blockedPaths.push({
        path: "(vault)",
        reasons: [`Selected content exceeds ${this.settings.maxTotalSyncMiB} MiB warning limit`],
      });
    }
    blockedPaths.sort((a, b) => a.path.localeCompare(b.path));
    return {
      snapshot: { scannedAt: new Date().toISOString(), entries, blockedPaths },
      hashCache: nextCache,
      totalBytes,
    };
  }

  private isExcluded(path: string, folder: boolean): boolean {
    const normalized = folder ? `${path.replace(/\/$/u, "")}/` : path;
    if (
      normalized === ".obsidian/plugins/vaultbridge-drive/" ||
      normalized.startsWith(".obsidian/plugins/vaultbridge-drive/")
    )
      return true;
    for (const exclusion of this.settings.exclusions) {
      const rule = exclusion.replaceAll("\\", "/");
      if (rule.endsWith("/") ? normalized.startsWith(rule) : normalized === rule) return true;
    }
    const parts = path.split("/");
    if (
      !this.settings.includeHiddenFiles &&
      parts.some((part) => part.startsWith(".") && part !== ".obsidian")
    )
      return true;
    if (path === ".obsidian" || path.startsWith(".obsidian/")) {
      if (!this.settings.includeObsidianConfig) return true;
      if (path.startsWith(".obsidian/themes/") && !this.settings.includeThemes) return true;
      if (path.startsWith(".obsidian/snippets/") && !this.settings.includeCssSnippets) return true;
      if (path.startsWith(".obsidian/plugins/") && !this.settings.includeCommunityPlugins)
        return true;
      if (
        path.startsWith(".obsidian/plugins/") &&
        path.endsWith("data.json") &&
        !this.settings.includePluginSettings
      )
        return true;
    }
    if (!folder) {
      const markdown = path.toLocaleLowerCase().endsWith(".md");
      if (markdown && !this.settings.includeNotes) return true;
      if (!markdown && !this.settings.includeAttachments) return true;
    }
    return false;
  }
}
