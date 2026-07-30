# Changelog

## 0.9.7 - 2026-07-30

- Allow local-change auto-sync to use a one-second debounce.
- Coalesce rapid Obsidian file events into one sync one second after the final event.

## 0.9.6 - 2026-07-30

- Make startup and foreground activation perform a preview-only remote check in the background.
- Show the editing guard only after incoming remote changes are found, then re-scan before applying
  them.
- Keep queued rename evidence intact during the background probe and leave outgoing work for the
  normal guarded sync paths.

## 0.9.5 - 2026-07-30

- Allow a proven one-to-one file rename to vacate a path before a different remote logical object
  downloads into it.
- Keep ambiguous moves, folder moves, case-only moves, occupied destinations, rename chains, and
  swaps collision-blocked.
- Disable sync execution for hard-blocked previews and give explicit collision-resolution guidance.
- Replace the routine iOS foreground modal with a quiet editing shield while retaining the mobile
  corner status indicator.

## 0.9.4 - 2026-07-29

- Run ordinary uploads, downloads, and renames automatically without a confirmation prompt.
- Keep mandatory review for deletion, recovery, conflict, blocked, purge, and mass-deletion plans.
- Block in-app editing during startup and foreground update checks, including desktop and iOS
  resume.
- Show persistent spinning, up-to-date, warning, and error sync status on desktop and mobile.

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
