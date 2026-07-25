import { describe, expect, it } from "vitest";
import { GOOGLE_SCOPES } from "../../src/auth/oauth-pkce";
import {
  SecretCredentialStore,
  VAULTBRIDGE_CREDENTIAL_SECRET_ID,
} from "../../src/auth/secret-credential-store";
import type { OAuthCredentials } from "../../src/types/domain";

const credentials: OAuthCredentials = {
  clientId: "client-id.apps.googleusercontent.com",
  clientSecret: "desktop-secret-placeholder",
  refreshToken: "refresh-secret-value",
  accessToken: "access-secret-value",
  accessTokenExpiresAt: Date.now() + 10_000,
  scopes: [...GOOGLE_SCOPES],
  accountEmail: "person@example.com",
  accountDisplayName: "Example Person",
};

describe("Obsidian Keychain credential store", () => {
  it("saves, restores, and clears credentials without a plugin passphrase", async () => {
    const storage = fakeSecretStorage();
    const store = new SecretCredentialStore(storage);
    await store.save(credentials);
    expect(storage.getSecret(VAULTBRIDGE_CREDENTIAL_SECRET_ID)).toContain(credentials.refreshToken);
    expect(storage.getSecret(VAULTBRIDGE_CREDENTIAL_SECRET_ID)).toContain(credentials.clientSecret);
    expect(await store.load()).toEqual(credentials);
    await store.clear();
    expect(await store.hasCredentials()).toBe(false);
    expect(await store.load()).toBeNull();
  });

  it("rejects a damaged Keychain entry", async () => {
    const storage = fakeSecretStorage();
    storage.setSecret(VAULTBRIDGE_CREDENTIAL_SECRET_ID, "{not-json");
    const store = new SecretCredentialStore(storage);
    await expect(store.load()).rejects.toThrow("Keychain entry is damaged");
  });
});

function fakeSecretStorage(): {
  getSecret(id: string): string | null;
  setSecret(id: string, secret: string): void;
} {
  const values = new Map<string, string>();
  return {
    getSecret: (id) => values.get(id) ?? null,
    setSecret: (id, secret) => {
      values.set(id, secret);
    },
  };
}
