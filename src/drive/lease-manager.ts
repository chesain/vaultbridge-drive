import { z } from "zod";
import { SyncError } from "../types/sync-errors";
import { randomId } from "../utils/crypto";
import type { AppDataStore } from "./appdata-store";

const leaseSchema = z
  .object({
    version: z.literal(1),
    vaultId: z.string().uuid(),
    deviceId: z.string().uuid(),
    token: z.string().min(16).max(128),
    createdAt: z.string().datetime(),
    renewedAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
  })
  .strict();

type LeaseRecord = z.infer<typeof leaseSchema>;

export interface LeaseHandle {
  record: LeaseRecord;
  assertHeld(signal?: AbortSignal): Promise<void>;
  renew(signal?: AbortSignal): Promise<void>;
  release(signal?: AbortSignal): Promise<void>;
}

export class LeaseManager {
  constructor(
    private readonly store: AppDataStore,
    private readonly now: () => number = Date.now,
    private readonly settle: () => Promise<void> = () =>
      new Promise((resolve) => setTimeout(resolve, 100)),
  ) {}

  async acquire(
    vaultId: string,
    shortVaultId: string,
    deviceId: string,
    ttlMs = 30_000,
    signal?: AbortSignal,
  ): Promise<LeaseHandle> {
    if (ttlMs < 5_000 || ttlMs > 120_000)
      throw new RangeError("Lease duration must be 5-120 seconds");
    const name = `lease-${shortVaultId}.json`;
    const existing = await this.read(name, signal);
    if (
      existing !== null &&
      Date.parse(existing.expiresAt) > this.now() &&
      existing.deviceId !== deviceId
    ) {
      throw conflict("Another device currently holds the vault lease");
    }
    const instant = this.now();
    const record: LeaseRecord = {
      version: 1,
      vaultId,
      deviceId,
      token: randomId(24),
      createdAt: new Date(instant).toISOString(),
      renewedAt: new Date(instant).toISOString(),
      expiresAt: new Date(instant + ttlMs).toISOString(),
    };
    await this.store.put(name, JSON.stringify(record), signal);
    await this.settle();
    const verify = await this.read(name, signal);
    if (verify?.token !== record.token) throw conflict("Could not acquire the vault lease");
    return this.handle(name, record, ttlMs);
  }

  private handle(name: string, initial: LeaseRecord, ttlMs: number): LeaseHandle {
    let current = initial;
    return {
      get record() {
        return current;
      },
      assertHeld: async (signal) => {
        const remote = await this.read(name, signal);
        if (remote?.token !== current.token || Date.parse(remote.expiresAt) <= this.now()) {
          throw conflict("Vault lease was lost or expired");
        }
      },
      renew: async (signal) => {
        const remote = await this.read(name, signal);
        if (remote?.token !== current.token) throw conflict("Vault lease was lost");
        const instant = this.now();
        current = {
          ...current,
          renewedAt: new Date(instant).toISOString(),
          expiresAt: new Date(instant + ttlMs).toISOString(),
        };
        await this.store.put(name, JSON.stringify(current), signal);
      },
      release: async (signal) => {
        const remote = await this.read(name, signal);
        if (remote?.token === current.token) await this.store.remove(name, signal);
      },
    };
  }

  private async read(name: string, signal?: AbortSignal): Promise<LeaseRecord | null> {
    const record = await this.store.get(name, signal);
    if (record === null) return null;
    try {
      return leaseSchema.parse(JSON.parse(record.content) as unknown);
    } catch (error) {
      throw new SyncError("REMOTE_CONFLICT", "Remote lease record is invalid", {
        retrySafe: false,
        userActionRequired: true,
        resumable: false,
        dataAtRisk: false,
        cause: error,
      });
    }
  }
}

function conflict(message: string): SyncError {
  return new SyncError("REMOTE_CONFLICT", message, {
    retrySafe: true,
    userActionRequired: false,
    resumable: true,
    dataAtRisk: false,
  });
}
