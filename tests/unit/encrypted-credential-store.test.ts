import { describe, expect, it } from "vitest";
import { MemoryCredentialBackend } from "../../src/auth/credential-store";
import { EncryptedCredentialStore } from "../../src/auth/encrypted-credential-store";
import { GOOGLE_SCOPES } from "../../src/auth/oauth-pkce";
import type { OAuthCredentials } from "../../src/types/domain";

const credentials: OAuthCredentials = {
  clientId: "client-id.apps.googleusercontent.com",
  refreshToken: "refresh-secret-value",
  accessToken: "access-secret-value",
  accessTokenExpiresAt: Date.now() + 10_000,
  scopes: [...GOOGLE_SCOPES],
};

describe("encrypted credential store", () => {
  it("encrypts and decrypts credentials", async () => {
    const backend = new MemoryCredentialBackend();
    const store = new EncryptedCredentialStore(backend, 100_000);
    expect(await store.unlock("correct horse battery staple")).toBe(true);
    await store.save(credentials);
    expect(backend.value).not.toContain(credentials.refreshToken);
    await store.lock();
    expect(await store.unlock("correct horse battery staple")).toBe(true);
    expect(await store.load()).toEqual(credentials);
  });

  it("rejects a wrong passphrase", async () => {
    const backend = new MemoryCredentialBackend();
    const store = new EncryptedCredentialStore(backend, 100_000);
    await store.unlock("correct horse battery staple");
    await store.save(credentials);
    await store.lock();
    expect(await store.unlock("incorrect horse battery staple")).toBe(false);
  });

  it("rejects tampered authenticated ciphertext", async () => {
    const backend = new MemoryCredentialBackend();
    const store = new EncryptedCredentialStore(backend, 100_000);
    await store.unlock("correct horse battery staple");
    await store.save(credentials);
    const envelope = JSON.parse(backend.value ?? "{}") as Record<string, string>;
    envelope.ciphertext = `${envelope.ciphertext?.slice(0, -2)}AA`;
    backend.value = JSON.stringify(envelope);
    await store.lock();
    expect(await store.unlock("correct horse battery staple")).toBe(false);
  });

  it("changes passphrase without changing credentials", async () => {
    const backend = new MemoryCredentialBackend();
    const store = new EncryptedCredentialStore(backend, 100_000);
    await store.unlock("correct horse battery staple");
    await store.save(credentials);
    await store.changePassphrase("a different secure passphrase");
    await store.lock();
    expect(await store.unlock("correct horse battery staple")).toBe(false);
    expect(await store.unlock("a different secure passphrase")).toBe(true);
    expect(await store.load()).toEqual(credentials);
  });

  it("can re-save refreshed credentials and unlock again", async () => {
    const backend = new MemoryCredentialBackend();
    const store = new EncryptedCredentialStore(backend, 100_000);
    await store.unlock("correct horse battery staple");
    await store.save(credentials);
    await store.save({ ...credentials, accessToken: "a-new-access-token" });
    await store.lock();
    expect(await store.unlock("correct horse battery staple")).toBe(true);
    expect((await store.load())?.accessToken).toBe("a-new-access-token");
  });

  it("clears persistent and in-memory credentials", async () => {
    const backend = new MemoryCredentialBackend();
    const store = new EncryptedCredentialStore(backend, 100_000);
    await store.unlock("correct horse battery staple");
    await store.save(credentials);
    await store.clear();
    expect(await store.hasCredentials()).toBe(false);
    expect(await store.load()).toBeNull();
  });

  it("never falls back to a short passphrase", async () => {
    const store = new EncryptedCredentialStore(new MemoryCredentialBackend(), 100_000);
    await expect(store.unlock("too-short")).rejects.toThrow("12-1024");
  });
});
