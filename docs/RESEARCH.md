# API research record

Verified on 2026-07-21 against official sources.

## Obsidian

The official sample plugin uses TypeScript, esbuild, `src/main.ts`, root `manifest.json` and
`styles.css`, and ships `main.js`, `manifest.json`, and `styles.css`. It documents Node 18 or newer
and the manual installation path `.obsidian/plugins/<plugin-id>/`.

Source: <https://github.com/obsidianmd/obsidian-sample-plugin>

## Google installed-app OAuth

Google documents Authorization Code for installed applications, a system browser, a loopback
redirect on a random port, a 43-128 character high-entropy verifier, S256 PKCE, and `state` to
prevent CSRF. Installed apps cannot keep a client secret confidential. The token exchange is
directly with `https://oauth2.googleapis.com/token`.

Source: <https://developers.google.com/identity/protocols/oauth2/native-app>

## Drive scopes and app data

`drive.file` is a non-sensitive, per-file scope covering files created by the app or shared/opened
with the app. `drive.appdata` manages the app's own hidden configuration data. The application data
folder is only accessible to the creating app and is addressed using parent/space `appDataFolder`.

Sources:

- <https://developers.google.com/workspace/drive/api/guides/api-specific-auth>
- <https://developers.google.com/workspace/drive/api/guides/appdata>

There is no literal Google OAuth scope that means “only this folder.” Vault isolation is an
additional application invariant, not a Google-enforced folder sandbox.

## Manifest concurrency

The current Drive v3 `files.update` reference does not document `If-Match` or an ETag precondition.
This release therefore does not claim such a guarantee. It uses a short-lived app-data lease,
re-reads the manifest revision while holding it, limits the lease duration, and commits the manifest
last. A future release may switch to a documented conditional primitive if Google publishes one for
the endpoint.

Source: <https://developers.google.com/workspace/drive/api/reference/rest/v3/files/update>
