import type { Vault } from "obsidian";
import type { SyncLocalAdapter } from "../sync/executor";
import type { FileStat, VaultAdapter } from "./vault-scanner";

export class ObsidianVaultAdapter implements VaultAdapter, SyncLocalAdapter {
  constructor(private readonly vault: Vault) {}

  async list(path: string): Promise<{ files: string[]; folders: string[] }> {
    return this.vault.adapter.list(path);
  }

  async stat(path: string): Promise<FileStat | null> {
    const stat = await this.vault.adapter.stat(path);
    if (stat === null) return null;
    return { type: stat.type, ctime: stat.ctime, mtime: stat.mtime, size: stat.size };
  }

  async exists(path: string): Promise<boolean> {
    return this.vault.adapter.exists(path);
  }

  async mkdir(path: string): Promise<void> {
    await this.vault.adapter.mkdir(path);
  }

  async readBinary(path: string): Promise<ArrayBuffer> {
    return this.vault.adapter.readBinary(path);
  }

  async writeBinary(path: string, data: ArrayBuffer): Promise<void> {
    await this.vault.adapter.writeBinary(path, data);
  }

  async rename(from: string, to: string): Promise<void> {
    await this.vault.adapter.rename(from, to);
  }

  async remove(path: string): Promise<void> {
    await this.vault.adapter.remove(path);
  }
}
