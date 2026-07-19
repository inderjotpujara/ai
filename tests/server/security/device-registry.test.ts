import { expect, test } from 'bun:test';
import { mkdtempSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDeviceRegistry } from '../../../src/server/security/device-registry.ts';

function tempPath(): string {
  return join(mkdtempSync(join(tmpdir(), 'dev-')), 'devices.json');
}

function tempRegistry() {
  return createDeviceRegistry({ path: tempPath() });
}

test('append then list returns the device (no token field ever)', () => {
  const reg = tempRegistry();
  reg.append({
    deviceId: 'd1',
    label: 'phone',
    createdAt: 1,
    exp: Date.now() + 100_000,
  });
  const items = reg.list();
  expect(items).toHaveLength(1);
  expect(items[0]?.deviceId).toBe('d1');
  expect('token' in (items[0] as object)).toBe(false);
});

test('append upserts on duplicate deviceId (no duplicate rows)', () => {
  const reg = tempRegistry();
  reg.append({
    deviceId: 'd1',
    label: 'old',
    createdAt: 1,
    exp: Date.now() + 100_000,
  });
  reg.append({
    deviceId: 'd1',
    label: 'new',
    createdAt: 2,
    exp: Date.now() + 200_000,
  });
  const items = reg.list();
  expect(items).toHaveLength(1);
  expect(items[0]?.label).toBe('new');
});

test('list prunes expired devices and persists the prune', () => {
  const path = tempPath();
  const reg = createDeviceRegistry({ path });
  reg.append({
    deviceId: 'live',
    label: 'a',
    createdAt: 1,
    exp: Date.now() + 100_000,
  });
  reg.append({
    deviceId: 'dead',
    label: 'b',
    createdAt: 1,
    exp: Date.now() - 1,
  });
  expect(reg.list().map((d) => d.deviceId)).toEqual(['live']);
  // A fresh registry over the SAME file sees the prune persisted.
  expect(
    createDeviceRegistry({ path })
      .list()
      .map((d) => d.deviceId),
  ).toEqual(['live']);
});

test('remove drops one device; clear drops all', () => {
  const reg = tempRegistry();
  reg.append({
    deviceId: 'd1',
    label: 'a',
    createdAt: 1,
    exp: Date.now() + 100_000,
  });
  reg.append({
    deviceId: 'd2',
    label: 'b',
    createdAt: 1,
    exp: Date.now() + 100_000,
  });
  reg.remove('d1');
  expect(reg.list().map((d) => d.deviceId)).toEqual(['d2']);
  reg.clear();
  expect(reg.list()).toEqual([]);
});

test('a corrupt registry file fails closed (throws at construction)', () => {
  const path = tempPath();
  writeFileSync(path, '{ not json');
  expect(() => createDeviceRegistry({ path })).toThrow();
});

test('a non-array registry file fails closed (throws at construction)', () => {
  const path = tempPath();
  writeFileSync(path, '{"deviceId":"x"}');
  expect(() => createDeviceRegistry({ path })).toThrow();
});

test('persisted registry file is written 0600 (owner-only)', () => {
  const path = tempPath();
  const reg = createDeviceRegistry({ path });
  reg.append({
    deviceId: 'd1',
    label: 'a',
    createdAt: 1,
    exp: Date.now() + 100_000,
  });
  const mode = statSync(path).mode & 0o777;
  expect(mode).toBe(0o600);
});
