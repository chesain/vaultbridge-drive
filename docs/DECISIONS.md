# Engineering decisions

## Conservative defaults

- Startup sync is enabled; change-triggered and periodic sync are initially disabled.
- Destructive previews are enabled.
- Recovery retention is 30 days and automatic purge is disabled.
- A plan deleting more than the lower of 20 objects or 10% of tracked objects is blocked.
- Files larger than 10 MiB use resumable uploads; maximum single upload defaults to 500 MiB.
- Desktop concurrency defaults to 4 and mobile to 2.
- Google credentials use Obsidian Keychain, avoiding a plugin-specific PIN or recurring passphrase.
- The legacy 0.9.0 PBKDF2-SHA-256 envelope remains only for one-time migration.

## Concurrency

Drive v3 does not currently document ETag preconditions for `files.update`, so manifest commits use
an expiring app-data lease plus revision revalidation. Lease acquisition is best-effort mutual
exclusion, not a distributed linearizability claim; a revision mismatch aborts and replans.

## Mobile

Direct loopback OAuth is desktop-only. Mobile joins through a short-lived, AES-GCM encrypted pairing
bundle created on an authenticated desktop. No raw refresh token is displayed.

## Local state

Google credentials live in Obsidian Keychain and not in VaultBridge's ordinary plugin data. Other
local index data is versioned but not encrypted; it contains paths and hashes, not note content or
credentials. The plugin's own directory remains an unconditional exclusion.

## First release limits

- Google Picker is not embedded; the app creates its own root folders, which is compatible with
  `drive.file`.
- Modification times are restored only when the active Obsidian adapter exposes a supported `utimes`
  method.
- A short text diff is provided for Markdown conflicts; automatic three-way merge is deferred.
