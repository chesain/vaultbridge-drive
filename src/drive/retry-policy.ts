export interface RetryDecision {
  retry: boolean;
  delayMs: number;
  category: "none" | "auth" | "quota" | "rate" | "server" | "network" | "precondition";
}

export interface RetryInput {
  attempt: number;
  status?: number;
  reason?: string;
  retryAfter?: string | null;
  networkError?: boolean;
  random?: () => number;
  now?: number;
}

const RETRYABLE_403 = new Set([
  "rateLimitExceeded",
  "userRateLimitExceeded",
  "sharingRateLimitExceeded",
]);

export function retryDecision(input: RetryInput): RetryDecision {
  const random = input.random ?? Math.random;
  const now = input.now ?? Date.now();
  if (input.attempt >= 5) return { retry: false, delayMs: 0, category: "none" };
  if (input.networkError) return withDelay("network", input.attempt, input.retryAfter, random, now);
  if (input.status === 412 || input.status === 409) {
    return { retry: false, delayMs: 0, category: "precondition" };
  }
  if (input.status === 401) return { retry: false, delayMs: 0, category: "auth" };
  if (input.status === 429) return withDelay("rate", input.attempt, input.retryAfter, random, now);
  if (input.status === 403 && input.reason !== undefined && RETRYABLE_403.has(input.reason)) {
    return withDelay("quota", input.attempt, input.retryAfter, random, now);
  }
  if (input.status !== undefined && input.status >= 500 && input.status <= 599) {
    return withDelay("server", input.attempt, input.retryAfter, random, now);
  }
  return { retry: false, delayMs: 0, category: "none" };
}

function withDelay(
  category: RetryDecision["category"],
  attempt: number,
  retryAfter: string | null | undefined,
  random: () => number,
  now: number,
): RetryDecision {
  const parsed = parseRetryAfter(retryAfter, now);
  const exponential = Math.min(32_000, 500 * 2 ** attempt);
  const jittered = Math.round(exponential * (0.5 + random()));
  return { retry: true, delayMs: Math.max(parsed ?? 0, jittered), category };
}

export function parseRetryAfter(value: string | null | undefined, now = Date.now()): number | null {
  if (value === null || value === undefined) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 120_000);
  const date = Date.parse(value);
  if (Number.isNaN(date)) return null;
  return Math.max(0, Math.min(date - now, 120_000));
}
