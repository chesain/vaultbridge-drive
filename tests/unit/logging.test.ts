import { describe, expect, it } from "vitest";
import { Logger, type LogRecord } from "../../src/logging/logger";
import { REDACTED, redact, redactText } from "../../src/logging/redaction";

describe("structured logging redaction", () => {
  it.each([
    ["Bearer abc.def.ghi", `Bearer ${REDACTED}`],
    ["https://x.test/?code=secret-code", `https://x.test/?code=${REDACTED}`],
    ["ya29.supersecrettokenvalue", REDACTED],
    ["1//refreshsecrettokenvalue", REDACTED],
  ])("redacts %s", (input, expected) => {
    expect(redactText(input)).toBe(expected);
  });

  it("redacts sensitive keys recursively", () => {
    expect(
      redact({
        nested: {
          refreshToken: "refresh-secret",
          clientSecret: "desktop-secret",
          okay: "value",
        },
      }),
    ).toEqual({
      nested: { refreshToken: REDACTED, clientSecret: REDACTED, okay: "value" },
    });
  });

  it("handles circular diagnostic objects", () => {
    const value: Record<string, unknown> = {};
    value.self = value;
    expect(redact(value)).toEqual({ self: "[CIRCULAR]" });
  });

  it("redacts before records reach a sink", () => {
    const records: LogRecord[] = [];
    new Logger("trace", (record) => records.push(record)).info("request", {
      authorization: "Bearer secret",
      accessToken: "token",
    });
    expect(JSON.stringify(records)).not.toContain("secret");
    expect(JSON.stringify(records)).not.toContain('"token"');
  });
});
