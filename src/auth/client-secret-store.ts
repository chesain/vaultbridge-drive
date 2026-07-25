import type { SecretStorage } from "obsidian";
import { z } from "zod";

export const VAULTBRIDGE_CLIENT_SECRET_ID = "vaultbridge-drive-google-client-secret";

const clientSecretSchema = z.string().trim().min(1).max(1024);

export class GoogleClientSecretStore {
  constructor(
    private readonly storage: Pick<SecretStorage, "getSecret" | "setSecret">,
    private readonly secretId = VAULTBRIDGE_CLIENT_SECRET_ID,
  ) {}

  async has(): Promise<boolean> {
    return (await this.load()) !== null;
  }

  async save(secret: string): Promise<void> {
    this.storage.setSecret(this.secretId, clientSecretSchema.parse(secret));
  }

  async load(): Promise<string | null> {
    const secret = this.storage.getSecret(this.secretId);
    if (secret === null || secret.length === 0) return null;
    return clientSecretSchema.parse(secret);
  }

  async clear(): Promise<void> {
    this.storage.setSecret(this.secretId, "");
  }
}
