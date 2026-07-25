import { constantTimeEqual, randomBytes, randomId, sha256Base64Url } from "../utils/crypto";
import { toBase64Url } from "../utils/encoding";

export const GOOGLE_AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/drive.appdata",
] as const;

export function assertMinimumGoogleScopes(scopes: readonly string[]): void {
  if (
    scopes.length !== GOOGLE_SCOPES.length ||
    !GOOGLE_SCOPES.every((scope) => scopes.includes(scope))
  ) {
    throw new Error("OAuth grant does not contain exactly the required least-privilege scopes");
  }
}

export interface PkceRequest {
  verifier: string;
  challenge: string;
  state: string;
}

export async function createPkceRequest(): Promise<PkceRequest> {
  const verifier = toBase64Url(randomBytes(64));
  return {
    verifier,
    challenge: await sha256Base64Url(verifier),
    state: randomId(32),
  };
}

export function validateOAuthState(expected: string, received: string | null): boolean {
  return received !== null && constantTimeEqual(expected, received);
}

export function buildAuthorizationUrl(input: {
  clientId: string;
  redirectUri: string;
  challenge: string;
  state: string;
  forceConsent?: boolean;
}): string {
  const parameters = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    code_challenge: input.challenge,
    code_challenge_method: "S256",
    state: input.state,
    access_type: "offline",
  });
  if (input.forceConsent) parameters.set("prompt", "consent");
  return `${GOOGLE_AUTHORIZATION_ENDPOINT}?${parameters.toString()}`;
}
