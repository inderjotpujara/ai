import { expect, test } from 'bun:test';
import { mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRootTokenStore } from '../../../src/server/security/root-token.ts';

const tempPath = () =>
  join(mkdtempSync(join(tmpdir(), 'root-')), 'daemon-token');

test('getOrCreateRoot mints once and is stable across calls (survives "restart")', () => {
  const path = tempPath();
  const a = createRootTokenStore({ path }).getOrCreateRoot();
  const b = createRootTokenStore({ path }).getOrCreateRoot(); // fresh store = "restart"
  expect(a).toBe(b);
  expect(a).toHaveLength(64); // 32 bytes hex
});

test('the token file is chmod 0600', () => {
  const path = tempPath();
  createRootTokenStore({ path }).getOrCreateRoot();
  expect(statSync(path).mode & 0o777).toBe(0o600);
});

test('rotate changes the root', () => {
  const path = tempPath();
  const store = createRootTokenStore({ path });
  const before = store.getOrCreateRoot();
  const after = store.rotate();
  expect(after).not.toBe(before);
  expect(store.getOrCreateRoot()).toBe(after); // persisted
});
