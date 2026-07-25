import type { GoogleDriveClient } from "./drive-client";
import type { DriveCreateInput, DriveFile } from "./drive-types";

export const DEFAULT_CHUNK_SIZE = 8 * 1024 * 1024;

export async function resumableUpload(
  client: GoogleDriveClient,
  input: DriveCreateInput,
  options: {
    chunkSize?: number;
    signal?: AbortSignal;
    onProgress?: (uploaded: number, total: number) => void;
  } = {},
): Promise<DriveFile> {
  const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
  if (chunkSize < 256 * 1024 || chunkSize % (256 * 1024) !== 0) {
    throw new RangeError("Resumable chunk size must be a positive multiple of 256 KiB");
  }
  const sessionUrl = await client.beginResumableCreate(
    { ...input, contentLength: input.content.byteLength },
    options.signal,
  );
  let offset = 0;
  while (offset < input.content.byteLength) {
    const end = Math.min(input.content.byteLength, offset + chunkSize);
    const chunk = input.content.slice(offset, end);
    const result = await client.uploadResumableChunk({
      sessionUrl,
      chunk,
      start: offset,
      total: input.content.byteLength,
      mimeType: input.mimeType,
      signal: options.signal,
    });
    if (result.complete) {
      if (result.file === undefined) throw new Error("Completed upload did not return metadata");
      options.onProgress?.(input.content.byteLength, input.content.byteLength);
      return result.file;
    }
    offset = result.committedBytes ?? end;
    options.onProgress?.(offset, input.content.byteLength);
  }
  throw new Error("Resumable upload ended without a completed file");
}
