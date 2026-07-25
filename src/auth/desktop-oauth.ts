import type { OAuthCredentials } from "../types/domain";
import { SyncError } from "../types/sync-errors";
import { startLoopbackServer, type LoopbackSession } from "./loopback-server";
import { buildAuthorizationUrl, createPkceRequest } from "./oauth-pkce";
import type { TokenManager } from "./token-manager";

export class DesktopOAuthService {
  private activeSession: LoopbackSession | null = null;

  constructor(
    private readonly tokenManager: TokenManager,
    private readonly openExternal: (url: string) => void = (url) => window.open(url, "_blank"),
  ) {}

  async connect(
    clientId: string,
    clientSecret: string | null,
    forceConsent = true,
  ): Promise<OAuthCredentials> {
    if (!clientId.endsWith(".apps.googleusercontent.com")) {
      throw new SyncError("AUTH_REQUIRED", "Enter a valid Google desktop OAuth client ID", {
        retrySafe: true,
        userActionRequired: true,
        resumable: false,
        dataAtRisk: false,
      });
    }
    this.cancel();
    const pkce = await createPkceRequest();
    const session = await startLoopbackServer(pkce.state);
    this.activeSession = session;
    const url = buildAuthorizationUrl({
      clientId,
      redirectUri: session.redirectUri,
      challenge: pkce.challenge,
      state: pkce.state,
      forceConsent,
    });
    this.openExternal(url);
    try {
      const callback = await session.result;
      return await this.tokenManager.exchangeCode({
        clientId,
        clientSecret,
        code: callback.code,
        verifier: pkce.verifier,
        redirectUri: callback.redirectUri,
      });
    } finally {
      this.activeSession = null;
    }
  }

  cancel(): void {
    this.activeSession?.cancel();
    this.activeSession = null;
  }
}
