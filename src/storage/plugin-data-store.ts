import type { CredentialEnvelopeBackend } from "../auth/credential-store";

export interface PluginDataAdapter {
  loadData(): Promise<unknown>;
  saveData(data: unknown): Promise<void>;
}

export class PluginDataStore {
  private data: Record<string, unknown> | null = null;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(private readonly adapter: PluginDataAdapter) {}

  async get<T>(key: string): Promise<T | null> {
    const data = await this.load();
    return key in data ? (structuredClone(data[key]) as T) : null;
  }

  async set(key: string, value: unknown): Promise<void> {
    await this.mutate((data) => {
      data[key] = structuredClone(value);
    });
  }

  async remove(key: string): Promise<void> {
    await this.mutate((data) => {
      delete data[key];
    });
  }

  private async load(): Promise<Record<string, unknown>> {
    if (this.data !== null) return this.data;
    const raw = await this.adapter.loadData();
    this.data =
      raw !== null && typeof raw === "object" && !Array.isArray(raw)
        ? (raw as Record<string, unknown>)
        : {};
    return this.data;
  }

  private async mutate(operation: (data: Record<string, unknown>) => void): Promise<void> {
    this.writeChain = this.writeChain.then(async () => {
      const data = await this.load();
      operation(data);
      await this.adapter.saveData(structuredClone(data));
    });
    await this.writeChain;
  }
}

export class PluginCredentialBackend implements CredentialEnvelopeBackend {
  constructor(private readonly store: PluginDataStore) {}

  async read(): Promise<string | null> {
    const value = await this.store.get<unknown>("credentialEnvelope");
    return typeof value === "string" ? value : null;
  }

  async write(value: string): Promise<void> {
    await this.store.set("credentialEnvelope", value);
  }

  async remove(): Promise<void> {
    await this.store.remove("credentialEnvelope");
  }
}
