const SENSITIVE_KEY =
  /(?:access.?token|refresh.?token|authorization|auth.?code|code.?verifier|pkce|pairing.?secret|credential.?bundle|client.?secret)/iu;
const BEARER = /Bearer\s+[A-Za-z0-9._~+/-]+=*/giu;
const TOKEN_QUERY = /([?&](?:code|access_token|refresh_token|code_verifier)=)[^&#\s]+/giu;
const GOOGLE_TOKENISH = /\b(?:ya29\.|1\/\/)[A-Za-z0-9._~+/-]{12,}/gu;

export const REDACTED = "[REDACTED]";

export function redactText(input: string): string {
  return input
    .replace(BEARER, `Bearer ${REDACTED}`)
    .replace(TOKEN_QUERY, `$1${REDACTED}`)
    .replace(GOOGLE_TOKENISH, REDACTED);
}

export function redact(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === "string") return redactText(value);
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return "[CIRCULAR]";
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => redact(item, seen));
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    output[key] = SENSITIVE_KEY.test(key) ? REDACTED : redact(child, seen);
  }
  return output;
}
