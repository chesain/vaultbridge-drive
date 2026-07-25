import { SyncError } from "../types/sync-errors";
import { utf8, fromUtf8 } from "../utils/encoding";
import type { GoogleDriveClient } from "./drive-client";
import type { DriveFile } from "./drive-types";

const SAFE_NAME = /^[A-Za-z0-9._-]{1,180}$/u;

export interface AppDataRecord {
  file: DriveFile;
  content: string;
  etag?: string;
}

export class AppDataStore {
  constructor(private readonly drive: GoogleDriveClient) {}

  async get(name: string, signal?: AbortSignal): Promise<AppDataRecord | null> {
    assertSafeName(name);
    const escaped = name.replaceAll("\\", "\\\\").replaceAll("'", "\\'");
    const files = await this.drive.listAllFiles({
      spaces: "appDataFolder",
      q: `name = '${escaped}' and trashed = false`,
      signal,
      maxFiles: 3,
    });
    if (files.length === 0) return null;
    if (files.length !== 1) {
      throw new SyncError("REMOTE_CONFLICT", `Duplicate app-data records found for ${name}`, {
        retrySafe: false,
        userActionRequired: true,
        resumable: false,
        dataAtRisk: false,
        diagnosticContext: { name, count: files.length },
      });
    }
    const file = files[0];
    if (file === undefined) return null;
    const downloaded = await this.drive.downloadFile(file.id, signal);
    return { file: downloaded.file, content: fromUtf8(downloaded.content), etag: downloaded.etag };
  }

  async put(name: string, content: string, signal?: AbortSignal): Promise<DriveFile> {
    assertSafeName(name);
    if (utf8(content).byteLength > 8 * 1024 * 1024) {
      throw new SyncError("MANIFEST_INVALID", "App-data record exceeds the 8 MiB limit", {
        retrySafe: false,
        userActionRequired: true,
        resumable: false,
        dataAtRisk: false,
      });
    }
    const existing = await this.get(name, signal);
    if (existing === null) {
      return this.drive.createFile(
        {
          name,
          parentId: "appDataFolder",
          mimeType: "application/json",
          appProperties: { objectType: "metadata" },
          content: utf8(content),
        },
        signal,
      );
    }
    return this.drive.updateFile(
      existing.file.id,
      { mimeType: "application/json", content: utf8(content) },
      signal,
    );
  }

  async remove(name: string, signal?: AbortSignal): Promise<void> {
    const existing = await this.get(name, signal);
    if (existing !== null) await this.drive.permanentlyDelete(existing.file.id, signal);
  }
}

function assertSafeName(name: string): void {
  if (!SAFE_NAME.test(name) || name.includes("..")) throw new Error("Unsafe app-data record name");
}
