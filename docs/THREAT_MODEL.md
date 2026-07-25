# Threat model

## Assets

Vault contents and names, OAuth refresh/access tokens, client configuration, manifest integrity,
deletion history, recovery data, and user intent.

## Trust boundaries

The Obsidian process and local device, system browser, loopback callback, Google OAuth endpoints,
Google Drive API, local filesystem adapter, and user-mediated pairing channel are distinct
boundaries. VaultBridge operates no server.

## Attackers

Malicious local software or device users, network attackers, OAuth response injectors, a compromised
or stale paired device, malformed/corrupt remote metadata, and accidental user or software actions.

## Threats and mitigations

| Threat                                     | Mitigation                                                                                             |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| Third party receives refresh token         | Direct Google token exchange; no broker or telemetry                                                   |
| Authorization interception or CSRF         | S256 PKCE, random state, loopback-only random port, timeout, one response                              |
| Secret leakage in logs/URLs                | Central recursive redaction; codes/tokens/verifier/bundle never logged; refresh token never put in URL |
| Credential exposed in ordinary plugin data | Obsidian Keychain/SecretStorage; legacy encrypted envelope removed after migration                     |
| Bug touches unrelated Drive data           | `drive.file`; random vault ID; root/manifest/logical ID allowlists; app-property and parent validation |
| Malicious manifest or traversal            | Strict runtime schema, size/schema limits, normalized relative paths, ID validation, checksum warning  |
| Invalid/cross-platform names               | Compatibility validator blocks without renaming                                                        |
| Stale device resurrects delete             | Revisioned tombstones dominate stale local snapshots                                                   |
| Concurrent commits                         | Expiring lease, revision re-read, bounded retry/replan, manifest committed last                        |
| Interrupted upload/download                | Pending state, transaction journal, hashes, temporary local writes, orphan cleanup                     |
| Retry repeats deletion                     | Stable operation IDs and postcondition checks; recovery move instead of permanent delete               |
| Accidental mass deletion                   | Lower of 20 files or 10% threshold; explicit confirmation; recovery retention                          |
| Token revocation                           | Typed auth-revoked state; pause sync; user reauthentication; no clearing on network errors             |
| Quota exhaustion                           | Jittered backoff, `Retry-After`, bounded concurrency, no correctness dependence on changes feed        |
| Lost device                                | Device access may expose Keychain credentials; user can revoke Google access from their account        |
| Pairing interception                       | AES-GCM, 256-bit one-time secret, expiry, nonce, explicit warning; no server upload                    |

## OAuth permission truth

Google does not offer a literal OAuth permission for “only this specific folder.” `drive.file`
limits access to files created by or explicitly made available to this OAuth application.
VaultBridge additionally enforces vault-specific identity and membership. This is not a
Google-enforced folder sandbox.

## Residual risks

A compromised unlocked device can read the vault and use live credentials. JavaScript cannot
guarantee that garbage-collected plaintext is physically erased. Google stores readable vault
content; content is not end-to-end encrypted. Drive leases reduce concurrency hazards but are not a
documented atomic compare-and-set.

## Non-goals

Protection from a fully compromised operating system, encrypted vault content, anonymous use,
background mobile execution, and automatic semantic merging of arbitrary formats.
