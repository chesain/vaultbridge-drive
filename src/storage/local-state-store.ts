import { z } from "zod";
import type { LocalSyncState, VaultManifest } from "../types/domain";
import { SyncError } from "../types/sync-errors";
import { uuid } from "../utils/crypto";
import type { PluginDataStore } from "./plugin-data-store";
import { validateManifest } from "../manifest/manifest-schema";

const stateSchema = z
  .object({
    schemaVersion: z.literal(1),
    deviceId: z.string().uuid(),
    lastCommittedRevision: z.number().int().nonnegative(),
    lastKnownEtag: z.string().max(500).optional(),
    lastLocalScan: z.string().datetime().optional(),
    baseManifest: z.unknown().optional(),
    localHashes: z.record(
      z.string(),
      z
        .object({
          size: z.number().nonnegative(),
          modifiedAt: z.number().nonnegative(),
          hash: z.string().regex(/^[a-f0-9]{64}$/u),
        })
        .strict(),
    ),
    pendingOperations: z.array(z.unknown()).max(100_000),
    journal: z.unknown().optional(),
    exclusions: z.array(z.string()).max(500),
    history: z.array(z.unknown()).max(500),
    recoveryRecords: z.array(z.unknown()).max(100_000),
    authState: z.enum(["disconnected", "locked", "ready", "revoked"]),
  })
  .strict();

export class LocalStateStore {
  constructor(private readonly data: PluginDataStore) {}

  async load(): Promise<LocalSyncState> {
    const raw = await this.data.get<unknown>("localState");
    if (raw === null) return createLocalState();
    const parsed = stateSchema.safeParse(raw);
    if (!parsed.success) {
      throw new SyncError(
        "LOCAL_STATE_INVALID",
        "Local synchronization database is invalid; rebuild it",
        {
          retrySafe: false,
          userActionRequired: true,
          resumable: false,
          dataAtRisk: false,
          cause: parsed.error,
        },
      );
    }
    const state = parsed.data as unknown as LocalSyncState;
    if (state.baseManifest !== undefined) state.baseManifest = validateManifest(state.baseManifest);
    return state;
  }

  async save(state: LocalSyncState): Promise<void> {
    const bounded = structuredClone(state);
    bounded.history = bounded.history.slice(-200);
    stateSchema.parse(bounded);
    await this.data.set("localState", bounded);
  }

  async rebuild(remoteManifest?: VaultManifest): Promise<LocalSyncState> {
    const current = await this.load().catch(() => createLocalState());
    const rebuilt = createLocalState(current.deviceId);
    if (remoteManifest !== undefined) {
      rebuilt.baseManifest = validateManifest(remoteManifest);
      rebuilt.lastCommittedRevision = remoteManifest.revision;
    }
    await this.save(rebuilt);
    return rebuilt;
  }
}

export function createLocalState(deviceId = uuid()): LocalSyncState {
  return {
    schemaVersion: 1,
    deviceId,
    lastCommittedRevision: 0,
    localHashes: {},
    pendingOperations: [],
    exclusions: [],
    history: [],
    recoveryRecords: [],
    authState: "disconnected",
  };
}
