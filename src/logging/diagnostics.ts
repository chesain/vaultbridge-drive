import type { SyncPhase } from "../types/domain";
import type { SyncPlan } from "../sync/sync-plan";
import { sha256 } from "../utils/crypto";
import { redact } from "./redaction";

export async function createDiagnostics(input: {
  pluginVersion: string;
  obsidianVersion: string;
  platform: string;
  phase: SyncPhase;
  errorCategory?: string;
  requestId?: string;
  manifestRevision?: number;
  deviceId: string;
  plan?: SyncPlan | null;
}): Promise<Record<string, unknown>> {
  const plan = input.plan;
  return redact({
    generatedAt: new Date().toISOString(),
    pluginVersion: input.pluginVersion,
    obsidianVersion: input.obsidianVersion,
    platform: input.platform,
    phase: input.phase,
    errorCategory: input.errorCategory,
    requestId: input.requestId,
    manifestRevision: input.manifestRevision,
    device: (await sha256(input.deviceId)).slice(0, 12),
    counts:
      plan === null || plan === undefined
        ? undefined
        : {
            uploads: plan.uploads.length,
            downloads: plan.downloads.length,
            remoteMoves: plan.remoteMoves.length,
            localMoves: plan.localMoves.length,
            conflicts: plan.conflicts.length,
            recoveries: plan.recoveries.length,
            deletes: plan.tombstonesToCreate.length,
            blocked: plan.blockedOperations.length,
          },
  }) as Record<string, unknown>;
}
