import type { PendingOperationRecord, TransactionJournal } from "../types/domain";
import { randomId } from "../utils/crypto";
import type { SyncPlan } from "./sync-plan";

export function createJournal(plan: SyncPlan, now = new Date()): TransactionJournal {
  const operations: PendingOperationRecord[] = allOperations(plan).map((operation) => ({
    operationId: operation.operationId,
    kind: operation.operationId.split(":", 1)[0] ?? "operation",
    logicalId: operation.logicalId,
    relativePath: operation.path,
    createdAt: now.toISOString(),
    state: "planned",
  }));
  return {
    transactionId: randomId(18),
    startedAt: now.toISOString(),
    baseRevision: plan.remoteRevision,
    targetRevision: plan.remoteRevision + 1,
    phase: "planned",
    operations,
  };
}

export function markJournalOperation(
  journal: TransactionJournal,
  operationId: string,
  state: PendingOperationRecord["state"],
): void {
  const record = journal.operations.find((candidate) => candidate.operationId === operationId);
  if (record !== undefined) record.state = state;
}

function allOperations(plan: SyncPlan) {
  return [
    ...plan.uploads,
    ...plan.downloads,
    ...plan.remoteMoves,
    ...plan.localMoves,
    ...plan.tombstonesToCreate,
    ...plan.recoveries,
    ...plan.purges,
  ];
}
