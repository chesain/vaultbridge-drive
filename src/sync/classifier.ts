import type { LocalFileState, ManifestEntry } from "../types/domain";

export type ChangeKind =
  | "absent"
  | "unchanged"
  | "created"
  | "deleted"
  | "modified"
  | "renamed"
  | "renamed-modified"
  | "type-changed";

export function classifyLocal(
  base: ManifestEntry | undefined,
  local: LocalFileState | undefined,
): ChangeKind {
  if (base === undefined) return local === undefined ? "absent" : "created";
  if (local === undefined) return "deleted";
  if (base.objectType !== local.objectType) return "type-changed";
  const renamed = base.relativePath !== local.relativePath;
  const modified = contentChanged(base, local);
  if (renamed && modified) return "renamed-modified";
  if (renamed) return "renamed";
  if (modified) return "modified";
  return "unchanged";
}

export function classifyRemote(
  base: ManifestEntry | undefined,
  remote: ManifestEntry | undefined,
): ChangeKind {
  if (base === undefined) return remote === undefined ? "absent" : "created";
  if (remote === undefined) return "deleted";
  if (base.objectType !== remote.objectType) return "type-changed";
  const renamed = base.relativePath !== remote.relativePath;
  const modified = contentChanged(base, remote);
  if (renamed && modified) return "renamed-modified";
  if (renamed) return "renamed";
  if (modified) return "modified";
  return "unchanged";
}

export function contentChanged(
  base: Pick<ManifestEntry, "objectType" | "contentHash" | "byteSize">,
  current: Pick<ManifestEntry | LocalFileState, "objectType" | "contentHash" | "byteSize">,
): boolean {
  if (base.objectType !== current.objectType) return true;
  if (base.objectType === "folder") return false;
  if (base.contentHash !== undefined && current.contentHash !== undefined)
    return base.contentHash !== current.contentHash;
  return base.byteSize !== current.byteSize;
}

export function sameContent(local: LocalFileState, remote: ManifestEntry): boolean {
  if (local.objectType !== remote.objectType) return false;
  if (local.objectType === "folder") return true;
  return local.contentHash !== undefined && remote.contentHash !== undefined
    ? local.contentHash === remote.contentHash
    : local.byteSize === remote.byteSize;
}
