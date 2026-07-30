# VaultBridge Drive

VaultBridge Drive is an unofficial Obsidian community plugin for least-privilege, recoverable,
crash-safe Google Drive synchronization. It is designed to never silently discard divergent changes.

> Release candidate 0.9.8. Live Google authorization and interactive Obsidian testing remain manual
> release gates; see [Known limitations](#known-limitations).

## Why this design

- Requests only `drive.file` and `drive.appdata`; it never requests unrestricted `drive` access.
- Exchanges OAuth authorization codes directly with Google using S256 PKCE and a loopback callback.
- Operates no refresh-token broker, analytics service, telemetry, or update service.
- Stores Google credentials in Obsidian Keychain instead of ordinary plugin data, with no recurring
  plugin passphrase.
- Identifies each vault with a random UUID and validates every Drive object against a capability
  allowlist, short vault/logical IDs, type, and parent.
- Commits the remote manifest last, journals interrupted work, verifies content hashes, preserves
  both conflict sides, and makes deletion recoverable.
- Uses full local scans for correctness, so Finder, File Explorer, shell, Git, and external-editor
  changes are detected.

Google does **not** offer a literal OAuth permission meaning “only this folder.” `drive.file` limits
the app to files it created or that a user explicitly made available to it; VaultBridge adds its own
vault-specific checks. This is not a Google-enforced folder sandbox.

Vault content is not end-to-end encrypted. Google can process content stored in the user's Drive
under the user's Google account terms.

## Install

### Release artifact

1. Extract the release ZIP.
2. Create `<vault>/.obsidian/plugins/vaultbridge-drive/`.
3. Copy `main.js`, `manifest.json`, and `styles.css` into that directory.
4. In Obsidian, enable Community plugins and then enable VaultBridge Drive.

### Build from source

```bash
npm ci
npm run validate
npm run package
```

Node 20 or newer is required.

## Google Cloud setup

Personal/development mode uses your own Google desktop OAuth client ID. Some newly issued desktop
credentials require their client secret at Google's token endpoint. Follow
[docs/GOOGLE_SETUP.md](docs/GOOGLE_SETUP.md), enter the ID and—when issued—the secret in VaultBridge
settings, and run **Connect Google Drive** on desktop. The secret is stored only in Obsidian
Keychain.

A maintained public client ID can be injected at build time later with
`VAULTBRIDGE_GOOGLE_CLIENT_ID`; no credential is committed.

## First sync

1. Open VaultBridge settings, enter the desktop OAuth client ID, and use **Set secret** if Google
   issued a client secret for it.
2. Run **Connect Google Drive** and complete consent in the system browser. The account is stored in
   Obsidian Keychain.
3. Select **Create remote vault**. The display name is only a label; VaultBridge creates a permanent
   UUID, starts the first safe sync automatically, and shows progress in the desktop status bar or
   the floating mobile status chip.

Ordinary uploads, downloads, and renames run without confirmation. Deletions, recovery moves,
conflicts, blocked operations, permanent purges, and mass-deletion plans always require review.
Change-triggered and periodic sync remain configurable. Local-change debounce can be set as low as
one second; rapid file events are combined into one sync after the final event. If editing resumes
after a scan begins, VaultBridge discards that stale upload attempt and quietly retries after the
next quiet window.

## Second device

On another desktop, connect with the same OAuth client configuration and select the registered
remote vault. VaultBridge checks quietly, then blocks in-app editing only after it finds remote
updates and while it downloads them. An empty fresh device downloads remote files; it is not
interpreted as a mass local deletion.

Whenever Obsidian starts or returns to the foreground on desktop or mobile, VaultBridge performs the
same preview-only pull check in the background. The bottom-corner status indicator spins during the
check. No popup appears and no outgoing sync runs when there are no incoming remote changes. If
incoming changes are found, VaultBridge opens an editing guard and performs a fresh scan before
applying them. Mandatory destructive or conflict review still uses an explicit dialog.

## Mobile pairing

Direct loopback OAuth is intentionally desktop-only. On an authenticated desktop, select the desired
vault and run **Export encrypted mobile pairing bundle**. Transfer the downloaded encrypted JSON
separately from the one-time secret, then run **Import encrypted pairing bundle** on mobile. The
default expiry is ten minutes. See [docs/MOBILE_PAIRING.md](docs/MOBILE_PAIRING.md).

## Conflicts

Timestamps never decide divergent edits. VaultBridge keeps the local content and puts the remote
side at a deterministic name such as:

```text
Research Notes (conflict from MacBook 2026-07-21 14-32 a1b2c3).md
```

The Conflict Center offers a line diff and **Keep local**, **Keep remote**, **Keep both**, and
**Manual merge** choices. Binary conflicts are also preserved as two files.

## Recovery

Deletes create revisioned tombstones and move remote content to `.vaultbridge-recovery`. Retention
defaults to 30 days; automatic permanent purge is off. Plans exceeding the lower of 20 objects or
10% of tracked objects require explicit confirmation. See [docs/RECOVERY.md](docs/RECOVERY.md).

## Exclusions

Defaults include `.trash/`, `.git/`, Obsidian workspace/cache files, and this plugin's own
directory. The latter is unconditional, even if other hidden/config/plugin content is enabled.
Synchronizing arbitrary third-party plugin data can expose secrets belonging to those plugins.

## Troubleshooting

- **Upgrading from 0.9.0:** enter the old credential passphrase once to move the Google login into
  Obsidian Keychain.
- **No refresh token:** reauthenticate; Google may require a new consent prompt.
- **Unverified app:** in a testing consent configuration, add the account as a test user.
- **Rate/quota error:** VaultBridge backs off and honors `Retry-After`; do not repeatedly force
  sync.
- **Manifest invalid:** do not reset or delete content. Export redacted diagnostics and inspect the
  remote app-data record before recovery.
- **Blocked path:** rename it explicitly on the source device; VaultBridge never silently renames
  user files.

Use **Copy redacted diagnostics** for support. Diagnostics never include note content, filenames,
authorization headers, or credentials.

## Uninstall and revoke access

Run **Disconnect Google Drive** first to revoke the refresh token at Google and remove the local
Keychain credential. To revoke manually, use the third-party access page in the Google Account. Then
disable VaultBridge and delete `.obsidian/plugins/vaultbridge-drive/`. Remote vault and recovery
content are not deleted automatically.

## Known limitations

- This environment did not provide Google credentials or an interactive Obsidian runtime, so the
  live OAuth consent screen, real Drive mutations, and desktop/mobile UI were not exercised here.
  Mocks cover their protocols; [manual release checks](docs/TESTING.md#manual-release-gates) remain.
- Drive v3 does not currently document an `If-Match` precondition for `files.update`. VaultBridge
  uses a short-lived app-data lease plus manifest revision verification. This reduces collisions but
  is not a claim of distributed linearizability.
- Mobile background execution is not assumed. Auto-sync runs while Obsidian is open.
- When a foreground probe finds incoming work, the editing guard covers the fresh pre-apply scan and
  application. Public plugin APIs cannot prevent an external editor, filesystem process, or another
  plugin from changing vault files.
- Obsidian's public adapter reads a whole file into memory. Transfers are chunked to Drive after
  that read, but extremely large attachments remain memory-constrained on mobile.
- Base file contents are not retained, so Conflict Center shows local/remote diff and reports when a
  base view is unavailable; it does not perform automatic three-way merge.
- Source modification time is restored only when the active adapter exposes a supported `utimes`
  capability; otherwise a warning is recorded.
- Recovery Center lists items in this release; one-click restore/purge execution is a remaining UI
  enhancement. Tombstones and retention enforcement are implemented in the core.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Threat model](docs/THREAT_MODEL.md)
- [Sync semantics](docs/SYNC_SEMANTICS.md)
- [Google setup](docs/GOOGLE_SETUP.md)
- [Mobile pairing](docs/MOBILE_PAIRING.md)
- [Recovery](docs/RECOVERY.md)
- [Privacy](PRIVACY.md)
- [Security policy](SECURITY.md)
- [Testing](docs/TESTING.md)
- [Release process](docs/RELEASE.md)
- [Clean-room note](docs/CLEAN_ROOM.md)

## Disclaimer

VaultBridge Drive is unofficial and is not endorsed by, affiliated with, or sponsored by Obsidian or
Google. “Google Drive” and “Obsidian” are trademarks of their respective owners.

Licensed under the MIT License.
