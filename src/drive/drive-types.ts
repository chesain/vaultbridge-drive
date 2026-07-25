export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  parents?: string[];
  appProperties?: Record<string, string>;
  size?: string;
  modifiedTime?: string;
  trashed?: boolean;
  md5Checksum?: string;
  version?: string;
  createdTime?: string;
}

export interface DriveFileList {
  files: DriveFile[];
  nextPageToken?: string;
}

export interface DriveObject<T = Uint8Array<ArrayBuffer>> {
  file: DriveFile;
  content: T;
  etag?: string;
}

export interface DriveCreateInput {
  name: string;
  parentId: string;
  mimeType: string;
  appProperties: Record<string, string>;
  content: Uint8Array<ArrayBuffer>;
  modifiedTime?: string;
}

export interface DriveUpdateInput {
  mimeType: string;
  content: Uint8Array<ArrayBuffer>;
  modifiedTime?: string;
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  query?: Record<string, string | number | boolean | undefined>;
  headers?: Record<string, string>;
  body?: BodyInit;
  signal?: AbortSignal;
  responseType?: "json" | "bytes" | "text" | "none";
  authenticated?: boolean;
}

export const DRIVE_FOLDER_MIME = "application/vnd.google-apps.folder";
