import { z } from "zod";
import type { DeviceAuthorization } from "../types/domain";
import type { AppDataStore } from "../drive/appdata-store";

const schema = z
  .object({
    schemaVersion: z.literal(1),
    vaultId: z.string().uuid(),
    devices: z.array(
      z
        .object({
          deviceId: z.string().uuid(),
          displayName: z.string().min(1).max(200),
          addedAt: z.string().datetime(),
          lastSeenAt: z.string().datetime().optional(),
        })
        .strict(),
    ),
  })
  .strict();

export class DeviceRegistryStore {
  constructor(private readonly appData: AppDataStore) {}

  async load(vaultId: string, signal?: AbortSignal): Promise<DeviceAuthorization[]> {
    const record = await this.appData.get(name(vaultId), signal);
    if (record === null) return [];
    return schema.parse(JSON.parse(record.content) as unknown).devices;
  }

  async upsert(vaultId: string, device: DeviceAuthorization, signal?: AbortSignal): Promise<void> {
    const devices = await this.load(vaultId, signal);
    const index = devices.findIndex((candidate) => candidate.deviceId === device.deviceId);
    if (index >= 0) devices[index] = device;
    else devices.push(device);
    await this.appData.put(
      name(vaultId),
      JSON.stringify(schema.parse({ schemaVersion: 1, vaultId, devices })),
      signal,
    );
  }
}

function name(vaultId: string): string {
  return `devices-${vaultId}.json`;
}
