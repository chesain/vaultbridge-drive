import type { SecretStorage } from "obsidian";
import type { OAuthCredentials } from "../types/domain";
import { SyncError } from "../types/sync-errors";
import type { CredentialStore } from "./credential-store";
import { oauthCredentialsSchema } from "./credential-schema";

export const VAULTBRIDGE_CREDENTIAL_SECRET_ID = "vaultbridge-drive-google-oauth";

export class SecretCredentialStore implements CredentialStore {
  constructor(
    private readonly storage: Pick<SecretStorage, "getSecret" | "setSecret">,
    private readonly secretId = VAULTBRIDGE_CREDENTIAL_SECRET_ID,
  ) {}

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async hasCredentials(): Promise<boolean> {
    const raw = this.storage.getSecret(this.secretId);
    return raw !== null && raw.length > 0;
  }

  async unlock(): Promise<boolean> {
    return true;
  }

  async save(credentials: OAuthCredentials): Promise<void> {
    const validated = oauthCredentialsSchema.parse(credentials);
    this.storage.setSecret(this.secretId, JSON.stringify(validated));
  }

  async load(): Promise<OAuthCredentials | null> {
    const raw = this.storage.getSecret(this.secretId);
    if (raw === null || raw.length === 0) return null;
    try {
      return oauthCredentialsSchema.parse(JSON.parse(raw) as unknown);
    } catch (error) {
      throw new SyncError("CREDENTIAL_STORE_LOCKED", "VaultBridge Keychain entry is damaged", {
        retrySafe: false,
        userActionRequired: true,
        resumable: false,
        dataAtRisk: false,
        cause: error,
      });
    }
  }

  async clear(): Promise<void> {
    this.storage.setSecret(this.secretId, "");
  }

  async lock(): Promise<void> {
    // Obsidian owns the Keychain lifecycle.
  }

  async changePassphrase(): Promise<void> {
    // Retained for compatibility with the credential-store interface.
  }
}
