import { expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleDeviceList } from '../../../src/server/devices/list.ts';
import { createDeviceRegistry } from '../../../src/server/security/device-registry.ts';

test('GET /api/devices returns the registry rows (never a token)', async () => {
  const reg = createDeviceRegistry({
    path: join(mkdtempSync(join(tmpdir(), 'dev-')), 'd.json'),
  });
  reg.append({
    deviceId: 'd1',
    label: 'phone',
    createdAt: 1,
    exp: Date.now() + 100_000,
  });
  const res = handleDeviceList({ deviceRegistry: reg });
  const body = (await res.json()) as { items: Record<string, unknown>[] };
  expect(body.items).toHaveLength(1);
  const [item] = body.items;
  expect(item).toEqual({
    deviceId: 'd1',
    label: 'phone',
    createdAt: 1,
    exp: expect.any(Number),
  });
  expect('token' in (item ?? {})).toBe(false);
});

test('GET /api/devices returns an empty list when nothing is paired', async () => {
  const reg = createDeviceRegistry({
    path: join(mkdtempSync(join(tmpdir(), 'dev-')), 'd.json'),
  });
  const res = handleDeviceList({ deviceRegistry: reg });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { items: unknown[] };
  expect(body.items).toEqual([]);
});
