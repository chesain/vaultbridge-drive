# Security policy

## Supported versions

Security fixes are developed for the latest published minor release. This repository currently
contains a 0.9 release candidate and makes no unsupported response-time promise.

## Reporting a vulnerability

Do not open a public issue containing credentials, private vault paths, note content, pairing
bundles, or exploitable details. Contact the maintainer through the private security-reporting
method listed on the eventual project repository. Until a repository address is assigned, do not
distribute a suspected release artifact.

Include the plugin version, Obsidian/platform version, reproduction steps, impact, and **redacted**
diagnostics. Never send a Keychain credential, legacy passphrase, pairing secret, access/refresh
token, OAuth client secret, authorization code, PKCE verifier, or note content.

## Immediate containment

If credentials may be exposed:

1. Revoke the application's access in the Google Account third-party access page.
2. Choose **Forget local credentials** on the affected device.
3. Reconnect unaffected devices only after revocation.
4. Treat any unexpired pairing bundle plus pairing secret as compromised and wait for expiry.
5. Preserve only redacted logs for investigation; do not publish credential material.

## Safe log collection

Use **Copy redacted diagnostics**. Review the result before sharing. The action contains counts and
hashed/short identifiers, not filenames, note contents, OAuth headers, or tokens. Debug/trace logs
remain subject to review even though central redaction is tested.

## Response expectations

Maintainers should acknowledge a report when available, reproduce it, assess affected versions, and
coordinate a fix and disclosure. No guaranteed response or remediation time is promised until a
maintained project and contact channel are established.
