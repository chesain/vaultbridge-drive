# Mobile pairing

## Flow

1. Authenticate a desktop device through direct PKCE OAuth.
2. Select the remote vault to authorize and export a pairing bundle.
3. Desktop creates a 256-bit one-time secret, random AES-GCM IV, nonce, creation time, and
   ten-minute expiry.
4. The encrypted payload contains the OAuth client ID, optional Desktop client secret, refresh
   token, exact scopes, and selected vault registry entries. The raw credential is never displayed.
5. Transfer the encrypted JSON separately from the one-time secret.
6. On mobile, import both. Decryption and expiry validation happen locally.
7. Mobile immediately writes the credentials into Obsidian Keychain on that device.

No pairing data is uploaded to a VaultBridge server; no such server exists. Encrypted text/file
transfer works without a camera.

## Threat model

Anyone who obtains **both** the encrypted bundle and one-time secret before expiry can import the
credentials. Encryption does not protect against a compromised source or destination device. Keep
the two pieces on separate channels, import promptly, and delete transfer copies afterward.

AES-GCM authenticates the bundle. A wrong key, modified ciphertext, future creation time, unknown
format, invalid registry entry, broad/missing OAuth scope, or expired bundle is rejected. JavaScript
can release references after import but cannot guarantee physical memory erasure.

If exposure is suspected, revoke the app in the Google Account and reconnect all devices.
