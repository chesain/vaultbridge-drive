import type { SyncPolicy } from "../types/domain";

const INVALID = /[<>:"|?*]/gu;

export function conflictPath(
  originalPath: string,
  logicalId: string,
  policy: SyncPolicy,
  timestamp: string,
): string {
  const slash = originalPath.lastIndexOf("/");
  const directory = slash >= 0 ? originalPath.slice(0, slash + 1) : "";
  const filename = slash >= 0 ? originalPath.slice(slash + 1) : originalPath;
  const dot = filename.lastIndexOf(".");
  const hasExtension = dot > 0;
  const stem = hasExtension ? filename.slice(0, dot) : filename;
  const extension = hasExtension ? filename.slice(dot) : "";
  const safeDevice =
    Array.from(policy.deviceName, (character) => (character.codePointAt(0)! < 32 ? "-" : character))
      .join("")
      .replace(INVALID, "-")
      .replace(/[. ]+$/u, "")
      .slice(0, 40) || "device";
  const safeTime = timestamp
    .replace("T", " ")
    .replace(/:\d{2}(?:\.\d+)?Z$/u, "")
    .replaceAll(":", "-");
  const suffix = ` (conflict from ${safeDevice} ${safeTime} ${logicalId.slice(-6)})`;
  const maxName = Math.min(policy.maxFilenameLength, 180);
  const allowedStem = Math.max(1, maxName - extension.length - suffix.length);
  const name = `${stem.slice(0, allowedStem)}${suffix}${extension}`;
  const maxDirectoryAware = Math.max(1, policy.maxPathLength - directory.length);
  return `${directory}${name.slice(0, maxDirectoryAware)}`;
}
