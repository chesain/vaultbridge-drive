import type { LocalEvent } from "../local/event-queue";
import type { LocalFileState, ManifestEntry } from "../types/domain";

export interface LocalAssignment {
  byLogicalId: Record<string, LocalFileState>;
  newEntries: Array<{ logicalId: string; state: LocalFileState }>;
  ambiguousPaths: string[];
}

export function assignLocalLogicalIds(
  baseEntries: Record<string, ManifestEntry>,
  localEntries: Record<string, LocalFileState>,
  events: LocalEvent[],
): LocalAssignment {
  const byLogicalId: Record<string, LocalFileState> = {};
  const claimedPaths = new Set<string>();
  const claimedIds = new Set<string>();
  const baseByPath = new Map(
    Object.values(baseEntries).map((entry) => [entry.relativePath, entry]),
  );

  for (const state of Object.values(localEntries).sort(pathOrder)) {
    const explicitId = state.logicalId;
    const match = baseByPath.get(state.relativePath);
    const matchedId = explicitId ?? match?.logicalId;
    if (matchedId !== undefined && !claimedIds.has(matchedId)) {
      byLogicalId[matchedId] = { ...state, logicalId: matchedId };
      claimedPaths.add(state.relativePath);
      claimedIds.add(matchedId);
    }
  }

  for (const event of events.filter(
    (item): item is Extract<LocalEvent, { type: "rename" }> => item.type === "rename",
  )) {
    const base = baseByPath.get(event.oldPath);
    const local = localEntries[event.path];
    if (
      base !== undefined &&
      local !== undefined &&
      !claimedIds.has(base.logicalId) &&
      !claimedPaths.has(local.relativePath)
    ) {
      byLogicalId[base.logicalId] = { ...local, logicalId: base.logicalId };
      claimedIds.add(base.logicalId);
      claimedPaths.add(local.relativePath);
    }
  }

  const ambiguousPaths: string[] = [];
  for (const state of Object.values(localEntries).sort(pathOrder)) {
    if (
      claimedPaths.has(state.relativePath) ||
      state.objectType !== "file" ||
      state.contentHash === undefined
    )
      continue;
    const candidates = Object.values(baseEntries).filter(
      (base) =>
        !claimedIds.has(base.logicalId) &&
        base.objectType === "file" &&
        base.contentHash === state.contentHash &&
        base.byteSize === state.byteSize,
    );
    if (candidates.length === 1) {
      const base = candidates[0];
      if (base === undefined) continue;
      byLogicalId[base.logicalId] = { ...state, logicalId: base.logicalId };
      claimedIds.add(base.logicalId);
      claimedPaths.add(state.relativePath);
    } else if (candidates.length > 1) {
      ambiguousPaths.push(state.relativePath);
    }
  }

  const newEntries: LocalAssignment["newEntries"] = [];
  const usedNewIds = new Set<string>();
  for (const state of Object.values(localEntries).sort(pathOrder)) {
    if (claimedPaths.has(state.relativePath)) continue;
    let logicalId = deterministicLocalId(state);
    let suffix = 0;
    while (baseEntries[logicalId] !== undefined || usedNewIds.has(logicalId)) {
      suffix += 1;
      logicalId = `${deterministicLocalId(state).slice(0, 27)}_${suffix}`;
    }
    usedNewIds.add(logicalId);
    const assigned = { ...state, logicalId };
    byLogicalId[logicalId] = assigned;
    newEntries.push({ logicalId, state: assigned });
  }
  return { byLogicalId, newEntries, ambiguousPaths: ambiguousPaths.sort() };
}

function deterministicLocalId(state: LocalFileState): string {
  const input = `${state.objectType}\0${state.relativePath}\0${state.contentHash ?? ""}\0${state.byteSize ?? ""}`;
  let hash = 0xcbf29ce484222325n;
  for (const character of new TextEncoder().encode(input)) {
    hash ^= BigInt(character);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return `l_${hash.toString(16).padStart(16, "0")}`;
}

function pathOrder(a: LocalFileState, b: LocalFileState): number {
  return a.relativePath.localeCompare(b.relativePath);
}
