import { z } from "zod";
import type { HttpFetch } from "../net/obsidian-http";
import type { OAuthCredentials } from "../types/domain";
import { SyncError } from "../types/sync-errors";
import { redactText } from "../logging/redaction";
import type { CredentialStore } from "./credential-store";
import { GOOGLE_SCOPES, GOOGLE_TOKEN_ENDPOINT, assertMinimumGoogleScopes } from "./oauth-pkce";

const tokenResponseSchema = z
  .object({
    access_token: z.string().min(1),
    expires_in: z.number().int().positive(),
    refresh_token: z.string().min(1).optional(),
    scope: z.string().optional(),
    token_type: z.string().optional(),
  })
  .passthrough();

export class TokenManager {
  private refreshInFlight: Promise<string> | null = null;

  constructor(
    private readonly store: CredentialStore,
    private readonly fetcher: HttpFetch,
  ) {}

  async getAccessToken(forceRefresh = false): Promise<string> {
    const credentials = await this.store.load();
    if (credentials === null) throw authRequired();
    if (
      !forceRefresh &&
      credentials.accessToken !== undefined &&
      (credentials.accessTokenExpiresAt ?? 0) > Date.now() + 60_000
    ) {
      return credentials.accessToken;
    }
    this.refreshInFlight ??= this.refresh(credentials).finally(() => {
      this.refreshInFlight = null;
    });
    return this.refreshInFlight;
  }

  async exchangeCode(input: {
    clientId: string;
    clientSecret?: string | null;
    code: string;
    verifier: string;
    redirectUri: string;
  }): Promise<OAuthCredentials> {
    const body = new URLSearchParams({
      client_id: input.clientId,
      code: input.code,
      code_verifier: input.verifier,
      redirect_uri: input.redirectUri,
      grant_type: "authorization_code",
    });
    if (input.clientSecret !== undefined && input.clientSecret !== null) {
      body.set("client_secret", input.clientSecret);
    }
    const response = await this.fetcher(GOOGLE_TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const parsed = await parseTokenResponse(response);
    if (parsed.refresh_token === undefined) {
      throw new SyncError(
        "AUTH_REQUIRED",
        "Google did not return a refresh token; reconnect with consent",
        {
          retrySafe: true,
          userActionRequired: true,
          resumable: false,
          dataAtRisk: false,
        },
      );
    }
    const scopes = parsed.scope?.split(" ") ?? [...GOOGLE_SCOPES];
    assertMinimumGoogleScopes(scopes);
    const credentials: OAuthCredentials = {
      clientId: input.clientId,
      ...(input.clientSecret === undefined || input.clientSecret === null
        ? {}
        : { clientSecret: input.clientSecret }),
      refreshToken: parsed.refresh_token,
      accessToken: parsed.access_token,
      accessTokenExpiresAt: Date.now() + parsed.expires_in * 1000,
      scopes,
      tokenType: parsed.token_type,
    };
    await this.store.save(credentials);
    return credentials;
  }

  private async refresh(credentials: OAuthCredentials): Promise<string> {
    let response: Response;
    try {
      response = await this.fetcher(GOOGLE_TOKEN_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: tokenRefreshBody(credentials),
      });
    } catch (error) {
      throw new SyncError("NETWORK_OFFLINE", "Could not reach Google OAuth", {
        retrySafe: true,
        userActionRequired: false,
        resumable: true,
        dataAtRisk: false,
        cause: error,
      });
    }
    const parsed = await parseTokenResponse(response);
    const updated: OAuthCredentials = {
      ...credentials,
      accessToken: parsed.access_token,
      accessTokenExpiresAt: Date.now() + parsed.expires_in * 1000,
      tokenType: parsed.token_type ?? credentials.tokenType,
      scopes: parsed.scope?.split(" ") ?? credentials.scopes,
    };
    if (parsed.refresh_token !== undefined) updated.refreshToken = parsed.refresh_token;
    await this.store.save(updated);
    return parsed.access_token;
  }
}

function tokenRefreshBody(credentials: OAuthCredentials): URLSearchParams {
  const body = new URLSearchParams({
    client_id: credentials.clientId,
    refresh_token: credentials.refreshToken,
    grant_type: "refresh_token",
  });
  if (credentials.clientSecret !== undefined) body.set("client_secret", credentials.clientSecret);
  return body;
}

async function parseTokenResponse(
  response: Response,
): Promise<z.infer<typeof tokenResponseSchema>> {
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const reason = typeof body.error === "string" ? body.error : "token_request_failed";
    const description =
      typeof body.error_description === "string"
        ? redactText(body.error_description.trim()).slice(0, 500)
        : undefined;
    const diagnosticContext = {
      status: response.status,
      reason,
      ...(description === undefined || description.length === 0 ? {} : { description }),
    };
    if (reason === "invalid_grant") {
      throw new SyncError("AUTH_REVOKED", "Google access was revoked; reauthenticate", {
        retrySafe: false,
        userActionRequired: true,
        resumable: false,
        dataAtRisk: false,
        diagnosticContext,
      });
    }
    throw new SyncError(
      "AUTH_REQUIRED",
      description === undefined || description.length === 0
        ? "Google token request failed"
        : `Google token request failed: ${description}`,
      {
        retrySafe: response.status >= 500,
        userActionRequired: response.status < 500,
        resumable: response.status >= 500,
        dataAtRisk: false,
        diagnosticContext,
      },
    );
  }
  return tokenResponseSchema.parse(body);
}

function authRequired(): SyncError {
  return new SyncError("AUTH_REQUIRED", "Connect Google Drive first", {
    retrySafe: false,
    userActionRequired: true,
    resumable: false,
    dataAtRisk: false,
  });
}
