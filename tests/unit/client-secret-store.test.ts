import { describe, expect, it } from "vitest";
import {
  GoogleClientSecretStore,
  VAULTBRIDGE_CLIENT_SECRET_ID,
} from "../../src/auth/client-secret-store";

describe("Google desktop client secret store", () => {
  it("saves and clears the secret through Obsidian Keychain", async () => {
    const storage = fakeSecretStorage();
    const store = new GoogleClientSecretStore(storage);

    await store.save("  desktop-secret-placeholder  ");
    expect(storage.getSecret(VAULTBRIDGE_CLIENT_SECRET_ID)).toBe("desktop-secret-placeholder");
    expect(await store.has()).toBe(true);
    expect(await store.load()).toBe("desktop-secret-placeholder");

    await store.clear();
    expect(await store.has()).toBe(false);
    expect(await store.load()).toBeNull();
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
