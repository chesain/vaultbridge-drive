import type { OAuthCredentials } from "../types/domain";

export interface CredentialStore {
  isAvailable(): Promise<boolean>;
  hasCredentials(): Promise<boolean>;
  unlock(passphrase: string): Promise<boolean>;
  save(credentials: OAuthCredentials): Promise<void>;
  load(): Promise<OAuthCredentials | null>;
  clear(): Promise<void>;
  lock(): Promise<void>;
  changePassphrase(newPassphrase: string): Promise<void>;
}

export interface CredentialEnvelopeBackend {
  read(): Promise<string | null>;
  write(value: string): Promise<void>;
  remove(): Promise<void>;
}

export class MemoryCredentialBackend implements CredentialEnvelopeBackend {
  value: string | null = null;

  async read(): Promise<string | null> {
    return this.value;
  }

  async write(value: string): Promise<void> {
    this.value = value;
  }

  async remove(): Promise<void> {
    this.value = null;
  }
}
