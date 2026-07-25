import { z } from "zod";
import type { TokenManager } from "../auth/token-manager";
import type { Logger } from "../logging/logger";
import type { HttpFetch } from "../net/obsidian-http";
import { SyncError } from "../types/sync-errors";
import { randomId } from "../utils/crypto";
import { fromUtf8, utf8 } from "../utils/encoding";
import { assertValidDriveFileId } from "../local/path-validator";
import type {
  DriveCreateInput,
  DriveFile,
  DriveFileList,
  DriveObject,
  DriveUpdateInput,
  RequestOptions,
} from "./drive-types";
import { DRIVE_FOLDER_MIME } from "./drive-types";
import { retryDecision } from "./retry-policy";

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3";

const fileSchema = z
  .object({
    id: z.string().min(10).max(200),
    name: z.string().min(1).max(1000),
    mimeType: z.string().min(1).max(300),
    parents: z.array(z.string().min(10).max(200)).optional(),
    appProperties: z.record(z.string(), z.string()).optional(),
    size: z.string().regex(/^\d+$/u).optional(),
    modifiedTime: z.string().optional(),
    createdTime: z.string().optional(),
    trashed: z.boolean().optional(),
    md5Checksum: z.string().optional(),
    version: z.string().optional(),
  })
  .passthrough();

const fileListSchema = z
  .object({ files: z.array(fileSchema).default([]), nextPageToken: z.string().optional() })
  .passthrough();

const aboutSchema = z
  .object({
    user: z
      .object({
        displayName: z.string().min(1).max(500).optional(),
        emailAddress: z.string().email().max(320).optional(),
      })
      .passthrough(),
  })
  .passthrough();

export class GoogleDriveClient {
  constructor(
    private readonly tokenManager: TokenManager,
    private readonly logger: Logger,
    private readonly fetcher: HttpFetch,
    private readonly sleeper: (milliseconds: number) => Promise<void> = (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
  ) {}

  async getCurrentUser(): Promise<{ emailAddress?: string; displayName?: string }> {
    const response = await this.request("/about", {
      query: { fields: "user(displayName,emailAddress)" },
    });
    return aboutSchema.parse(response.body).user;
  }

  async getFile(fileId: string, signal?: AbortSignal): Promise<{ file: DriveFile; etag?: string }> {
    assertValidDriveFileId(fileId);
    const response = await this.request(`/files/${encodeURIComponent(fileId)}`, {
      query: { fields: fileFields() },
      signal,
    });
    return {
      file: fileSchema.parse(response.body),
      etag: response.headers.get("etag") ?? undefined,
    };
  }

  async listFiles(input: {
    q?: string;
    spaces?: "drive" | "appDataFolder";
    pageToken?: string;
    pageSize?: number;
    signal?: AbortSignal;
  }): Promise<DriveFileList> {
    const response = await this.request("/files", {
      query: {
        q: input.q,
        spaces: input.spaces,
        pageToken: input.pageToken,
        pageSize: input.pageSize ?? 1000,
        fields: `nextPageToken,files(${fileFields()})`,
        orderBy: "name_natural",
      },
      signal: input.signal,
    });
    return fileListSchema.parse(response.body);
  }

  async listAllFiles(input: {
    q?: string;
    spaces?: "drive" | "appDataFolder";
    signal?: AbortSignal;
    maxFiles?: number;
  }): Promise<DriveFile[]> {
    const files: DriveFile[] = [];
    let pageToken: string | undefined;
    do {
      const page = await this.listFiles({ ...input, pageToken });
      files.push(...page.files);
      if (files.length > (input.maxFiles ?? 25_000)) {
        throw new SyncError("REMOTE_CONFLICT", "Drive listing exceeded the safety limit", {
          retrySafe: false,
          userActionRequired: true,
          resumable: false,
          dataAtRisk: false,
        });
      }
      pageToken = page.nextPageToken;
    } while (pageToken !== undefined);
    return files;
  }

  async createFolder(input: {
    name: string;
    parentId: string;
    appProperties: Record<string, string>;
    signal?: AbortSignal;
  }): Promise<DriveFile> {
    assertValidDriveFileId(input.parentId);
    const response = await this.request("/files", {
      method: "POST",
      query: { fields: fileFields() },
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: input.name,
        mimeType: DRIVE_FOLDER_MIME,
        parents: [input.parentId],
        appProperties: input.appProperties,
      }),
      signal: input.signal,
    });
    return fileSchema.parse(response.body);
  }

  async createFile(input: DriveCreateInput, signal?: AbortSignal): Promise<DriveFile> {
    assertValidDriveFileId(input.parentId);
    const boundary = `vaultbridge_${randomId(12)}`;
    const metadata = {
      name: input.name,
      mimeType: input.mimeType,
      parents: [input.parentId],
      appProperties: input.appProperties,
      ...(input.modifiedTime === undefined ? {} : { modifiedTime: input.modifiedTime }),
    };
    const body = multipartBody(boundary, metadata, input.mimeType, input.content);
    const response = await this.request(
      "/files",
      {
        method: "POST",
        query: { uploadType: "multipart", fields: fileFields() },
        headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
        body,
        signal,
      },
      DRIVE_UPLOAD,
    );
    return fileSchema.parse(response.body);
  }

  async beginResumableCreate(
    input: Omit<DriveCreateInput, "content"> & { contentLength: number },
    signal?: AbortSignal,
  ): Promise<string> {
    assertValidDriveFileId(input.parentId);
    const response = await this.request(
      "/files",
      {
        method: "POST",
        query: { uploadType: "resumable", fields: fileFields() },
        headers: {
          "Content-Type": "application/json",
          "X-Upload-Content-Type": input.mimeType,
          "X-Upload-Content-Length": String(input.contentLength),
        },
        body: JSON.stringify({
          name: input.name,
          mimeType: input.mimeType,
          parents: [input.parentId],
          appProperties: input.appProperties,
          ...(input.modifiedTime === undefined ? {} : { modifiedTime: input.modifiedTime }),
        }),
        signal,
        responseType: "none",
      },
      DRIVE_UPLOAD,
    );
    const location = response.headers.get("location");
    if (location === null || !location.startsWith("https://www.googleapis.com/")) {
      throw new SyncError("UPLOAD_FAILED", "Google did not return a resumable upload URL", {
        retrySafe: true,
        userActionRequired: false,
        resumable: true,
        dataAtRisk: false,
      });
    }
    return location;
  }

  async uploadResumableChunk(input: {
    sessionUrl: string;
    chunk: Uint8Array<ArrayBuffer>;
    start: number;
    total: number;
    mimeType: string;
    signal?: AbortSignal;
  }): Promise<{ complete: boolean; file?: DriveFile; committedBytes?: number }> {
    if (!input.sessionUrl.startsWith("https://www.googleapis.com/"))
      throw new Error("Invalid upload session URL");
    const end = input.start + input.chunk.byteLength - 1;
    const response = await this.rawRequest(
      input.sessionUrl,
      {
        method: "PUT",
        headers: {
          "Content-Type": input.mimeType,
          "Content-Length": String(input.chunk.byteLength),
          "Content-Range": `bytes ${input.start}-${end}/${input.total}`,
        },
        body: input.chunk,
        signal: input.signal,
      },
      true,
      new Set([308]),
    );
    if (response.status === 308) {
      const range = response.headers.get("range");
      const match = range?.match(/bytes=0-(\d+)/u);
      return {
        complete: false,
        committedBytes: match === null || match === undefined ? input.start : Number(match[1]) + 1,
      };
    }
    return { complete: true, file: fileSchema.parse(response.body) };
  }

  async updateFile(
    fileId: string,
    input: DriveUpdateInput,
    signal?: AbortSignal,
  ): Promise<DriveFile> {
    assertValidDriveFileId(fileId);
    const boundary = `vaultbridge_${randomId(12)}`;
    const metadata = input.modifiedTime === undefined ? {} : { modifiedTime: input.modifiedTime };
    const response = await this.request(
      `/files/${encodeURIComponent(fileId)}`,
      {
        method: "PATCH",
        query: { uploadType: "multipart", fields: fileFields() },
        headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
        body: multipartBody(boundary, metadata, input.mimeType, input.content),
        signal,
      },
      DRIVE_UPLOAD,
    );
    return fileSchema.parse(response.body);
  }

  async updateMetadata(
    fileId: string,
    metadata: Record<string, unknown>,
    query: Record<string, string | undefined> = {},
    signal?: AbortSignal,
  ): Promise<DriveFile> {
    assertValidDriveFileId(fileId);
    const response = await this.request(`/files/${encodeURIComponent(fileId)}`, {
      method: "PATCH",
      query: { ...query, fields: fileFields() },
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(metadata),
      signal,
    });
    return fileSchema.parse(response.body);
  }

  async downloadFile(fileId: string, signal?: AbortSignal): Promise<DriveObject> {
    assertValidDriveFileId(fileId);
    const metadata = await this.getFile(fileId, signal);
    const response = await this.request(`/files/${encodeURIComponent(fileId)}`, {
      query: { alt: "media" },
      responseType: "bytes",
      signal,
    });
    return {
      file: metadata.file,
      content: response.body as Uint8Array<ArrayBuffer>,
      etag: metadata.etag,
    };
  }

  async permanentlyDelete(fileId: string, signal?: AbortSignal): Promise<void> {
    assertValidDriveFileId(fileId);
    await this.request(`/files/${encodeURIComponent(fileId)}`, {
      method: "DELETE",
      responseType: "none",
      signal,
    });
  }

  private async request(
    path: string,
    options: RequestOptions,
    base = DRIVE_API,
  ): Promise<{ status: number; headers: Headers; body: unknown }> {
    return this.rawRequest(`${base}${path}`, options, options.authenticated !== false);
  }

  private async rawRequest(
    rawUrl: string,
    options: RequestOptions,
    authenticated: boolean,
    acceptedStatuses = new Set<number>(),
  ): Promise<{ status: number; headers: Headers; body: unknown }> {
    const correlationId = randomId(9);
    const url = new URL(rawUrl);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    let refreshed = false;
    for (let attempt = 0; attempt <= 5; attempt += 1) {
      try {
        const headers = new Headers(options.headers);
        if (authenticated)
          headers.set(
            "Authorization",
            `Bearer ${await this.tokenManager.getAccessToken(refreshed)}`,
          );
        const response = await this.fetcher(url.toString(), {
          method: options.method ?? "GET",
          headers,
          body: options.body,
          signal: options.signal,
        });
        if (response.status === 401 && authenticated && !refreshed) {
          refreshed = true;
          continue;
        }
        const responseType = options.responseType ?? "json";
        const body = await readResponse(response, responseType);
        if (response.ok || acceptedStatuses.has(response.status)) {
          return { status: response.status, headers: response.headers, body };
        }
        const reason = extractReason(body);
        const decision = retryDecision({
          attempt,
          status: response.status,
          reason,
          retryAfter: response.headers.get("retry-after"),
        });
        this.logger.warn("drive_request_failed", {
          correlationId,
          status: response.status,
          reason,
          attempt,
          retry: decision.retry,
        });
        if (decision.retry) {
          await this.sleeper(decision.delayMs);
          continue;
        }
        throw driveError(response.status, reason, correlationId);
      } catch (error) {
        if (error instanceof SyncError) throw error;
        if (options.signal?.aborted === true) {
          throw new SyncError("USER_CANCELLED", "Google Drive request was cancelled", {
            retrySafe: true,
            userActionRequired: false,
            resumable: true,
            dataAtRisk: false,
            diagnosticContext: { correlationId },
            cause: error,
          });
        }
        const decision = retryDecision({ attempt, networkError: true });
        if (!decision.retry) {
          throw new SyncError("NETWORK_OFFLINE", "Google Drive request failed", {
            retrySafe: true,
            userActionRequired: false,
            resumable: true,
            dataAtRisk: false,
            diagnosticContext: { correlationId },
            cause: error,
          });
        }
        await this.sleeper(decision.delayMs);
      }
    }
    throw new SyncError("NETWORK_OFFLINE", "Google Drive retry limit reached", {
      retrySafe: true,
      userActionRequired: false,
      resumable: true,
      dataAtRisk: false,
      diagnosticContext: { correlationId },
    });
  }
}

function multipartBody(
  boundary: string,
  metadata: Record<string, unknown>,
  mimeType: string,
  content: Uint8Array<ArrayBuffer>,
): Blob {
  return new Blob(
    [
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`,
      `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
      content,
      `\r\n--${boundary}--`,
    ],
    { type: `multipart/related; boundary=${boundary}` },
  );
}

async function readResponse(
  response: Response,
  type: RequestOptions["responseType"],
): Promise<unknown> {
  if (type === "none" || response.status === 204) return undefined;
  if (type === "bytes") return new Uint8Array(await response.arrayBuffer());
  if (type === "text") return response.text();
  const text = await response.text();
  if (text.length === 0) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { error: { message: fromUtf8(utf8(text.slice(0, 200))) } };
  }
}

function extractReason(body: unknown): string | undefined {
  if (body === null || typeof body !== "object") return undefined;
  const error = (body as Record<string, unknown>).error;
  if (error === null || typeof error !== "object") return undefined;
  const errors: unknown = (error as Record<string, unknown>).errors;
  if (!Array.isArray(errors) || errors.length === 0) return undefined;
  const first: unknown = errors[0];
  if (first === null || typeof first !== "object") return undefined;
  const reason = (first as Record<string, unknown>).reason;
  return typeof reason === "string" ? reason : undefined;
}

function driveError(status: number, reason: string | undefined, correlationId: string): SyncError {
  const diagnosticContext = { status, reason, correlationId };
  if (status === 401) {
    return new SyncError("AUTH_REVOKED", "Google authorization is no longer valid", {
      retrySafe: false,
      userActionRequired: true,
      resumable: false,
      dataAtRisk: false,
      diagnosticContext,
    });
  }
  if (status === 403) {
    const normalizedReason = reason?.toLocaleLowerCase() ?? "";
    const quota = normalizedReason.includes("limit") || normalizedReason.includes("quota");
    return new SyncError(
      quota ? "QUOTA_EXCEEDED" : "PERMISSION_DENIED",
      quota ? "Google Drive quota was exceeded" : "Google Drive denied the request",
      {
        retrySafe: quota,
        userActionRequired: !quota,
        resumable: quota,
        dataAtRisk: false,
        diagnosticContext,
      },
    );
  }
  if (status === 409 || status === 412) {
    return new SyncError("REMOTE_CONFLICT", "Remote state changed; synchronization must re-plan", {
      retrySafe: true,
      userActionRequired: false,
      resumable: true,
      dataAtRisk: false,
      diagnosticContext,
    });
  }
  if (status === 429) {
    return new SyncError("RATE_LIMITED", "Google Drive rate limit was reached", {
      retrySafe: true,
      userActionRequired: false,
      resumable: true,
      dataAtRisk: false,
      diagnosticContext,
    });
  }
  return new SyncError("UNKNOWN", `Google Drive request failed (${status})`, {
    retrySafe: status >= 500,
    userActionRequired: status < 500,
    resumable: status >= 500,
    dataAtRisk: false,
    diagnosticContext,
  });
}

function fileFields(): string {
  return "id,name,mimeType,parents,appProperties,size,modifiedTime,createdTime,trashed,md5Checksum,version";
}
