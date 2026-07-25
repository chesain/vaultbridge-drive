import { describe, expect, it } from "vitest";
import {
  GOOGLE_SCOPES,
  buildAuthorizationUrl,
  createPkceRequest,
  validateOAuthState,
} from "../../src/auth/oauth-pkce";

describe("OAuth PKCE", () => {
  it("generates a high-entropy verifier, S256 challenge, and state", async () => {
    const request = await createPkceRequest();
    expect(request.verifier.length).toBeGreaterThanOrEqual(43);
    expect(request.verifier.length).toBeLessThanOrEqual(128);
    expect(request.challenge).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(request.state.length).toBeGreaterThan(32);
  });

  it("generates unique requests", async () => {
    const [a, b] = await Promise.all([createPkceRequest(), createPkceRequest()]);
    expect(a).not.toEqual(b);
  });

  it("uses only the two required scopes", () => {
    expect(GOOGLE_SCOPES).toEqual([
      "https://www.googleapis.com/auth/drive.file",
      "https://www.googleapis.com/auth/drive.appdata",
    ]);
  });

  it("builds an installed-app authorization URL", () => {
    const url = new URL(
      buildAuthorizationUrl({
        clientId: "client.apps.googleusercontent.com",
        redirectUri: "http://127.0.0.1:12345/oauth2callback",
        challenge: "challenge",
        state: "state",
        forceConsent: true,
      }),
    );
    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("scope")?.split(" ")).toEqual(GOOGLE_SCOPES);
  });

  it("validates state without accepting prefixes", () => {
    expect(validateOAuthState("abc", "abc")).toBe(true);
    expect(validateOAuthState("abc", "abcd")).toBe(false);
    expect(validateOAuthState("abc", null)).toBe(false);
  });
});
