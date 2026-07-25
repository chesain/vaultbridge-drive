# Changelog

## 0.9.3 - 2026-07-25

- Support Google desktop OAuth clients whose token endpoint requires the issued client secret.
- Store the user-supplied client secret only in Obsidian Keychain and redact it from diagnostics.
- Send the secret during authorization-code exchange and token refresh when configured.
- Transfer the secret only inside the encrypted mobile pairing payload.

## 0.9.2 - 2026-07-24

- Fix Google OAuth token and revocation requests by passing form encoding through Obsidian's
  dedicated `requestUrl` content-type option.
- Surface Google's redacted OAuth error description in notices and diagnostics.
- Add regression coverage for Obsidian form requests and safe token error reporting.

## 0.9.1 - 2026-07-24

- Store Google credentials in Obsidian Keychain with a one-time migration from the 0.9.0
  passphrase-encrypted store.
- Show the connected Google account and refresh account state immediately after actions.
- Replace plugin network `fetch` calls with Obsidian `requestUrl` for mobile compatibility.
- Fix desktop OAuth loopback startup under Obsidian's CommonJS plugin runtime.

## 0.9.0 - 2026-07-21

- Initial clean-room release candidate.
- Direct Google OAuth with PKCE and desktop loopback redirect.
- Encrypted local credentials and encrypted mobile pairing.
- Capability-limited Drive client, vault registry, manifest, planner, journal, recovery, and UI.
- Unit, property, security, and integration test suites.
