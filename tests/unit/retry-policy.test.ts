import { describe, expect, it } from "vitest";
import { parseRetryAfter, retryDecision } from "../../src/drive/retry-policy";

describe("Drive retry policy", () => {
  it.each([
    [429, undefined, true, "rate"],
    [500, undefined, true, "server"],
    [503, undefined, true, "server"],
    [401, undefined, false, "auth"],
    [403, "rateLimitExceeded", true, "quota"],
    [403, "insufficientPermissions", false, "none"],
    [404, undefined, false, "none"],
    [409, undefined, false, "precondition"],
    [412, undefined, false, "precondition"],
  ] as const)("handles status %s reason %s", (status, reason, retry, category) => {
    expect(retryDecision({ attempt: 0, status, reason, random: () => 0 })).toMatchObject({
      retry,
      category,
    });
  });

  it("honors Retry-After seconds", () => {
    expect(
      retryDecision({ attempt: 0, status: 429, retryAfter: "10", random: () => 0 }).delayMs,
    ).toBe(10_000);
  });

  it("parses an HTTP-date Retry-After", () => {
    expect(
      parseRetryAfter("Tue, 21 Jul 2026 10:00:10 GMT", Date.parse("2026-07-21T10:00:00Z")),
    ).toBe(10_000);
  });

  it("caps retries", () => {
    expect(retryDecision({ attempt: 5, status: 500 }).retry).toBe(false);
  });
});
