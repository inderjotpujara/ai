import { DeviceListResponseSchema } from '../../contracts/index.ts';
import { ISOLATION_HEADERS } from '../isolation-headers.ts';
import type { DeviceRegistry } from '../security/device-registry.ts';

export type DeviceListDeps = { deviceRegistry: DeviceRegistry };

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...ISOLATION_HEADERS,
    },
  });
}

/** `GET /api/devices` — paired-device list for the Devices tab. Prunes expired
 *  rows on read (registry.list). Never returns a token (the registry has none). */
export function handleDeviceList(deps: DeviceListDeps): Response {
  const items = deps.deviceRegistry.list();
  return json(DeviceListResponseSchema.parse({ items }), 200);
}
