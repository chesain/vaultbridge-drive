export type SyncErrorCode =
  | "AUTH_REQUIRED"
  | "AUTH_REVOKED"
  | "CREDENTIAL_STORE_LOCKED"
  | "NETWORK_OFFLINE"
  | "RATE_LIMITED"
  | "QUOTA_EXCEEDED"
  | "REMOTE_CONFLICT"
  | "MANIFEST_INVALID"
  | "LOCAL_STATE_INVALID"
  | "PATH_UNSUPPORTED"
  | "MASS_DELETION_BLOCKED"
  | "UPLOAD_FAILED"
  | "DOWNLOAD_FAILED"
  | "HASH_MISMATCH"
  | "LOCAL_CHANGED"
  | "PERMISSION_DENIED"
  | "USER_CANCELLED"
  | "UNKNOWN";

export interface SyncErrorOptions {
  retrySafe: boolean;
  userActionRequired: boolean;
  resumable: boolean;
  dataAtRisk: boolean;
  diagnosticContext?: Record<string, unknown>;
  cause?: unknown;
}

export class SyncError extends Error {
  readonly code: SyncErrorCode;
  readonly retrySafe: boolean;
  readonly userActionRequired: boolean;
  readonly resumable: boolean;
  readonly dataAtRisk: boolean;
  readonly diagnosticContext: Record<string, unknown>;

  constructor(code: SyncErrorCode, message: string, options: SyncErrorOptions) {
    super(message, { cause: options.cause });
    this.name = "SyncError";
    this.code = code;
    this.retrySafe = options.retrySafe;
    this.userActionRequired = options.userActionRequired;
    this.resumable = options.resumable;
    this.dataAtRisk = options.dataAtRisk;
    this.diagnosticContext = options.diagnosticContext ?? {};
  }
}

export function asSyncError(error: unknown): SyncError {
  if (error instanceof SyncError) return error;
  const message = error instanceof Error ? error.message : "Unknown synchronization error";
  return new SyncError("UNKNOWN", message, {
    retrySafe: false,
    userActionRequired: true,
    resumable: false,
    dataAtRisk: false,
    cause: error,
  });
}
