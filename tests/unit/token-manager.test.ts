import { describe, expect, it, vi } from "vitest";
import { TokenManager } from "../../src/auth/token-manager";
import type { CredentialStore } from "../../src/auth/credential-store";
import { SyncError } from "../../src/types/sync-errors";

describe("TokenManager", () => {
  it("sends and stores a configured desktop client secret during code exchange", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      tokenResponse({
        access_token: "access-token-placeholder",
        expires_in: 3600,
        refresh_token: "refresh-token-placeholder",
        scope:
          "https://www.googleapis.com/auth/drive.file " +
          "https://www.googleapis.com/auth/drive.appdata",
        token_type: "Bearer",
      }),
    );
    const store = credentialStore();
    const manager = new TokenManager(store, fetcher);

    const credentials = await manager.exchangeCode({
      clientId: "desktop-client.apps.googleusercontent.com",
      clientSecret: "desktop-secret-placeholder",
      code: "authorization-code",
      verifier: "pkce-verifier",
      redirectUri: "http://127.0.0.1:12345/oauth2callback",
    });

    const request = fetcher.mock.calls[0]?.[1] as RequestInit;
    expect(request.body).toBeInstanceOf(URLSearchParams);
    expect((request.body as URLSearchParams).get("client_secret")).toBe(
      "desktop-secret-placeholder",
    );
    expect(credentials.clientSecret).toBe("desktop-secret-placeholder");
    expect(store.save).toHaveBeenCalledWith(
      expect.objectContaining({ clientSecret: "desktop-secret-placeholder" }),
    );
  });

  it("sends the stored desktop client secret when refreshing", async () => {
    const credentials = {
      clientId: "desktop-client.apps.googleusercontent.com",
      clientSecret: "desktop-secret-placeholder",
      refreshToken: "refresh-token-placeholder",
      scopes: [
        "https://www.googleapis.com/auth/drive.file",
        "https://www.googleapis.com/auth/drive.appdata",
      ],
    };
    const store = credentialStore();
    vi.mocked(store.load).mockResolvedValue(credentials);
    const fetcher = vi.fn().mockResolvedValue(
      tokenResponse({
        access_token: "new-access-token-placeholder",
        expires_in: 3600,
        token_type: "Bearer",
      }),
    );

    await new TokenManager(store, fetcher).getAccessToken(true);

    const request = fetcher.mock.calls[0]?.[1] as RequestInit;
    expect((request.body as URLSearchParams).get("client_secret")).toBe(
      "desktop-secret-placeholder",
    );
  });

  it("surfaces Google's redacted error description for a rejected token exchange", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: "invalid_request",
          error_description:
            "Missing required parameter; diagnostic URL: https://example.test/?code=secret-code",
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );
    const manager = new TokenManager(credentialStore(), fetcher);

    const error = await manager
      .exchangeCode({
        clientId: "desktop-client.apps.googleusercontent.com",
        code: "authorization-code",
        verifier: "pkce-verifier",
        redirectUri: "http://127.0.0.1:12345/oauth2callback",
      })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(SyncError);
    expect(error).toMatchObject({
      code: "AUTH_REQUIRED",
      message:
        "Google token request failed: Missing required parameter; diagnostic URL: " +
        "https://example.test/?code=[REDACTED]",
      diagnosticContext: {
        status: 400,
        reason: "invalid_request",
        description:
          "Missing required parameter; diagnostic URL: https://example.test/?code=[REDACTED]",
      },
    });
  });
});

function credentialStore(): CredentialStore {
  return {
    isAvailable: vi.fn().mockResolvedValue(true),
    hasCredentials: vi.fn().mockResolvedValue(false),
    unlock: vi.fn().mockResolvedValue(true),
    save: vi.fn().mockResolvedValue(undefined),
    load: vi.fn().mockResolvedValue(null),
    clear: vi.fn().mockResolvedValue(undefined),
    lock: vi.fn().mockResolvedValue(undefined),
    changePassphrase: vi.fn().mockResolvedValue(undefined),
  };
}

function tokenResponse(body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
