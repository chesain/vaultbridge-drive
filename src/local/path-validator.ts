import { SyncError } from "../types/sync-errors";

const WINDOWS_RESERVED = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/iu;
const WINDOWS_INVALID = /[<>:"|?*]/u;
const DRIVE_ID = /^[A-Za-z0-9_-]{10,200}$/u;

export interface PathValidationOptions {
  maxPathLength?: number;
  maxFilenameLength?: number;
}

export interface PathValidationResult {
  normalized: string;
  valid: boolean;
  reasons: string[];
  caseFolded: string;
}

export function validateRelativePath(
  path: string,
  options: PathValidationOptions = {},
): PathValidationResult {
  const maxPathLength = options.maxPathLength ?? 240;
  const maxFilenameLength = options.maxFilenameLength ?? 180;
  const reasons: string[] = [];
  const normalized = path.replaceAll("\\", "/").normalize("NFC");

  if (path.length === 0) reasons.push("Path is empty");
  if (/^(?:\/|[A-Za-z]:\/|\\\\)/u.test(path)) reasons.push("Absolute paths are not allowed");
  if (normalized !== path.replaceAll("\\", "/")) reasons.push("Path is not Unicode NFC-normalized");
  if (normalized.length > maxPathLength) reasons.push(`Path exceeds ${maxPathLength} characters`);

  const parts = normalized.split("/");
  if (parts.some((part) => part === "")) reasons.push("Empty path components are not allowed");
  if (parts.some((part) => part === "." || part === ".."))
    reasons.push("Path traversal is not allowed");

  for (const part of parts) {
    if (part.length > maxFilenameLength)
      reasons.push(`Filename exceeds ${maxFilenameLength} characters`);
    if (WINDOWS_INVALID.test(part) || hasControlCharacter(part))
      reasons.push(`Filename contains Windows-invalid characters: ${part}`);
    if (WINDOWS_RESERVED.test(part)) reasons.push(`Filename is reserved on Windows: ${part}`);
    if (/[. ]$/u.test(part)) reasons.push(`Filename ends in a period or space: ${part}`);
  }

  return {
    normalized,
    valid: reasons.length === 0,
    reasons: Array.from(new Set(reasons)),
    caseFolded: normalized.toLocaleLowerCase("en-US"),
  };
}

function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => character.codePointAt(0)! < 32);
}

export function assertSafeRelativePath(path: string, options?: PathValidationOptions): string {
  const result = validateRelativePath(path, options);
  if (!result.valid) {
    throw new SyncError("PATH_UNSUPPORTED", `Unsupported path: ${path}`, {
      retrySafe: false,
      userActionRequired: true,
      resumable: false,
      dataAtRisk: false,
      diagnosticContext: { path, reasons: result.reasons },
    });
  }
  return result.normalized;
}

export function findPathCollisions(paths: string[]): Array<{ paths: string[]; reason: string }> {
  const groups = new Map<string, string[]>();
  for (const path of paths) {
    const validation = validateRelativePath(path);
    const values = groups.get(validation.caseFolded) ?? [];
    values.push(path);
    groups.set(validation.caseFolded, values);
  }
  return [...groups.values()]
    .filter((values) => new Set(values).size > 1)
    .map((values) => ({ paths: values.sort(), reason: "Paths collide after case folding" }));
}

export function isValidDriveFileId(value: string): boolean {
  return value === "root" || value === "appDataFolder" || DRIVE_ID.test(value);
}

export function assertValidDriveFileId(value: string): void {
  if (!isValidDriveFileId(value)) {
    throw new SyncError("PERMISSION_DENIED", "Rejected invalid Google Drive file ID", {
      retrySafe: false,
      userActionRequired: false,
      resumable: false,
      dataAtRisk: false,
    });
  }
}
