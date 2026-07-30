# Testing

## Automated commands

```bash
npm ci
npm run format:check
npm run lint
npm run typecheck
npm run test:unit
npm run test:integration
npm run test:coverage
npm run build
npm run secret-scan
npm run package
```

The suite uses Vitest, fake Drive HTTP responses, fake vault adapters/timers, and fast-check. It
covers PKCE/state, OAuth request encoding and error reporting, Keychain validation, legacy
encryption/tamper/migration primitives, manifest validation/migration/checksum, path compatibility,
hashing/cache behavior, planner classification/rename/conflict/tombstone/mass deletion, retry
policy, redaction, capability boundaries, pairing, journals, resumable chunks, mtime, and the 40
named integration scenarios from the specification.

## Manual release gates

These require a temporary Google project and throwaway Obsidian vault:

1. Install only the three packaged files and confirm Obsidian loads/unloads the plugin on Windows,
   macOS, Linux, iOS, and Android.
2. Follow Google setup; confirm the consent screen lists only `drive.file` and `drive.appdata`.
3. Inspect network traffic: authorization opens in the system browser, callback binds only
   `127.0.0.1`, token exchange goes directly to Google, and no token enters a URL/log.
4. Restart Obsidian; confirm the Keychain login is restored without a VaultBridge passphrase.
5. Create a remote vault, upload a fixture, and restore it to a second clean desktop.
6. Make divergent Markdown and binary edits on two devices; confirm both survive and Conflict Center
   choices converge.
7. Delete files/folders; confirm tombstones, remote recovery, stale-device protection, and
   mass-delete confirmation.
8. Kill Obsidian after upload, during download staging, and before manifest commit; confirm the
   prior manifest or journal recovery remains usable.
9. Force concurrent device commits; confirm lease/revision conflict aborts and re-plans.
10. Import mobile pairing before/after expiry and with a wrong secret.
11. Use external editors, shell, and Git while Obsidian is open; confirm full scan detects changes.
12. Test long/non-ASCII/reserved/case-only paths and mtime behavior on every platform.
13. Revoke access at Google and confirm AUTH_REVOKED pauses sync without clearing on network
    failure.
14. Review release ZIP contents and a fresh `npm audit`/secret scan.
15. On desktop and iOS, background and foreground Obsidian; confirm the initial pull probe runs with
    only the spinning status indicator and no popup when there is no incoming work.
16. Confirm the desktop status bar and mobile floating chip spin through active phases and settle
    into up-to-date, warning, offline, or error states.
17. Reproduce a preserved conflict object on one device, then resume a stale second device. Confirm
    a unique file rename can vacate the original path before its replacement download, while rename
    swaps and occupied destinations remain blocked.
18. On desktop and iOS, introduce a remote download while the app is inactive. Confirm activation
    opens the editing guard only after discovery, performs a fresh pre-apply scan, applies the
    download, and still presents mandatory conflict or destructive review when required.
19. With a one-second local-change debounce, resume typing while an upload begins. Confirm the stale
    attempt is quietly superseded, no user-action error appears, and the latest stable content
    uploads after the next quiet window.

Record manual results in `docs/TEST_RESULTS.md` before calling a build production-ready.
