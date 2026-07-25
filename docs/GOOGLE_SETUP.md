# Google Cloud setup

Verified against official Google documentation and a live token response on 2026-07-25. Google Cloud
Console labels can change; use the linked official pages as the authority.

## Personal/development client

1. Open the [Google Cloud Console](https://console.cloud.google.com/) and create or select a
   project.
2. Open **APIs & Services → Library**, find **Google Drive API**, and enable it.
3. Open **Google Auth Platform** (or **APIs & Services → OAuth consent screen**).
4. Configure Branding with an app name such as “VaultBridge Drive (Personal)”, support email, and
   developer contact.
5. Select the Audience. Use **Internal** only when all accounts belong to the same Workspace
   organization; otherwise use **External**.
6. Under Data Access, add exactly:

   ```text
   https://www.googleapis.com/auth/drive.file
   https://www.googleapis.com/auth/drive.appdata
   ```

   Do not add `https://www.googleapis.com/auth/drive`.

7. If the External app remains in Testing, add every Google account that will use it as a test user.
   Testing-mode refresh tokens can be subject to Google's testing restrictions; consult the current
   consent-screen documentation.
8. Open **Clients** (or **Credentials → Create credentials → OAuth client ID**), choose **Desktop
   app**, name it, and create it.
9. Copy the client ID ending in `.apps.googleusercontent.com` into VaultBridge settings.
10. Open the Desktop client details. If Google issued a client secret, choose **Set secret** in
    VaultBridge and paste it into the masked prompt. VaultBridge stores it only in Obsidian
    Keychain. Never paste it into chat, logs, source code, or ordinary plugin settings.
11. On desktop, run **Connect Google Drive**. The plugin binds a random `127.0.0.1` port and uses
    the corresponding loopback redirect automatically.

## Scope meaning

Google documents `drive.file` as per-file access for files created by the app or explicitly made
available to it. `drive.appdata` manages the app's hidden configuration folder. There is no literal
“this one folder only” OAuth permission. VaultBridge's root/manifest/logical-ID checks are an
additional application boundary.

Official sources:

- <https://developers.google.com/identity/protocols/oauth2/native-app>
- <https://developers.google.com/workspace/drive/api/guides/api-specific-auth>
- <https://developers.google.com/workspace/drive/api/guides/appdata>

## Maintained release mode

A maintainer may provide a verified public desktop client ID at build time:

```bash
VAULTBRIDGE_GOOGLE_CLIENT_ID=123.apps.googleusercontent.com npm run build
```

The release process must complete Google's applicable verification before distribution. This release
accepts a user-supplied Desktop client secret through Obsidian Keychain; it does not embed one in
the build. Google notes that installed applications cannot keep such a value confidential. Do not
publish automatically without explicit release authorization.

## Revocation

Use **Disconnect Google Drive** for direct revocation and local removal. If that fails, revoke the
app from the Google Account's third-party access page, then choose **Forget local credentials**.
