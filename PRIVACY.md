# Privacy

VaultBridge Drive operates no infrastructure. It has no analytics, telemetry, advertising, tracking
SDK, update beacon, crash reporter, or automatic diagnostic upload.

## Network communication

The plugin communicates only with:

- Google's OAuth authorization/token/revocation endpoints for account authorization.
- Google Drive API v3 upload, metadata, download, and app-data endpoints for selected vaults.

OAuth refresh tokens are exchanged directly with Google and are never sent to VaultBridge or any
other token broker. Pairing bundles are created and decrypted locally; the user chooses how to
transfer them.

Google receives vault filenames, metadata, and content because Google Drive is the selected storage
provider. Google can process this data according to the user's Google account terms. Vault content
is not end-to-end encrypted, zero-knowledge, or hidden from Google.

## Local storage

Obsidian Keychain stores the Google OAuth credential, including any user-supplied Desktop client
secret. Ordinary VaultBridge plugin data stores:

- Non-secret settings.
- Device UUID, paths, content hashes, manifest base, operation journal, history, and recovery
  records.

Versions 0.9.1 and later can read the AES-256-GCM credential envelope used by 0.9.0 solely to
migrate it into Obsidian Keychain. After a successful migration, the legacy envelope is removed.
JavaScript cannot guarantee physical memory erasure after values become unreachable.

VaultBridge's own plugin directory is unconditionally excluded from sync. Other third-party plugin
settings may contain secrets and are disabled by default.

## Diagnostics

Diagnostics are generated only on user request and copied locally. They include versions, platform,
phase, error category, hashed/short device identity, manifest revision, request ID, and operation
counts. They exclude note content, filenames, headers, tokens, authorization codes, PKCE verifier,
legacy passphrase, pairing secret, and encrypted bundle.
