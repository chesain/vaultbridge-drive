import { SyncError } from "../types/sync-errors";
import { validateOAuthState } from "./oauth-pkce";
import type * as NodeHttp from "node:http";

export interface LoopbackResult {
  code: string;
  redirectUri: string;
}

export interface LoopbackSession {
  redirectUri: string;
  result: Promise<LoopbackResult>;
  cancel: () => void;
}

export async function startLoopbackServer(
  expectedState: string,
  timeoutMs = 180_000,
): Promise<LoopbackSession> {
  // Obsidian desktop exposes CommonJS require; dynamic ESM imports of Node built-ins fail there.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const http = require("node:http") as typeof NodeHttp;
  let settled = false;
  let rejectResult: ((reason?: unknown) => void) | undefined;
  let resolveResult: ((value: LoopbackResult) => void) | undefined;

  const result = new Promise<LoopbackResult>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });

  const server = http.createServer((request, response) => {
    if (settled) {
      response.writeHead(410, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("This authorization request is no longer active.");
      return;
    }
    try {
      if (request.method !== "GET" || request.url === undefined) {
        response.writeHead(405).end();
        return;
      }
      const callback = new URL(request.url, "http://127.0.0.1");
      if (callback.pathname !== "/oauth2callback") {
        response.writeHead(404).end();
        return;
      }
      if (!validateOAuthState(expectedState, callback.searchParams.get("state"))) {
        response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("Authorization state mismatch. Return to Obsidian and try again.");
        finish(
          new SyncError("AUTH_REQUIRED", "OAuth state mismatch", {
            retrySafe: false,
            userActionRequired: true,
            resumable: false,
            dataAtRisk: false,
          }),
        );
        return;
      }
      const oauthError = callback.searchParams.get("error");
      const code = callback.searchParams.get("code");
      if (oauthError !== null || code === null || code.length < 4) {
        response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("Authorization was declined or invalid. You can close this tab.");
        finish(
          new SyncError(
            oauthError === "access_denied" ? "USER_CANCELLED" : "AUTH_REQUIRED",
            "OAuth authorization failed",
            {
              retrySafe: oauthError === "access_denied",
              userActionRequired: true,
              resumable: false,
              dataAtRisk: false,
              diagnosticContext: { oauthError },
            },
          ),
        );
        return;
      }
      const address = server.address();
      if (address === null || typeof address === "string")
        throw new Error("Loopback address unavailable");
      const redirectUri = `http://127.0.0.1:${address.port}/oauth2callback`;
      response.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
      });
      response.end(
        "<!doctype html><meta charset=utf-8><title>VaultBridge Drive</title>" +
          "<style>body{font:16px system-ui;padding:3rem;max-width:38rem;margin:auto}</style>" +
          "<h1>Authorization complete</h1><p>You can close this tab and return to Obsidian.</p>",
      );
      settled = true;
      clearTimeout(timeout);
      resolveResult?.({ code, redirectUri });
      server.close();
    } catch (error) {
      finish(error);
    }
  });

  function finish(error: unknown): void {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    server.close();
    rejectResult?.(error);
  }

  const timeout = setTimeout(() => {
    finish(
      new SyncError("USER_CANCELLED", "Google authorization timed out", {
        retrySafe: true,
        userActionRequired: true,
        resumable: false,
        dataAtRisk: false,
      }),
    );
  }, timeoutMs);

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    finish(new Error("Could not bind loopback server"));
    throw new Error("Could not bind loopback server");
  }
  const redirectUri = `http://127.0.0.1:${address.port}/oauth2callback`;
  return {
    redirectUri,
    result,
    cancel: () =>
      finish(
        new SyncError("USER_CANCELLED", "Google authorization cancelled", {
          retrySafe: true,
          userActionRequired: false,
          resumable: false,
          dataAtRisk: false,
        }),
      ),
  };
}
