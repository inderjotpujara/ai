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

// Fix 3 — atomic mint-once: getOrCreateRoot writes with `{ flag: 'wx' }`
// (O_EXCL) so two concurrent first-boot calls can never mint DIVERGENT roots;
// the loser re-reads and returns the winner's token instead of overwriting
// it. Sync code can't force a true OS-level interleaving, so we simulate the
// race as closely as sync code allows: repeated/independent store instances
// over the same path must always converge on one token, and a pre-existing
// file must never be overwritten by a later call.
test('two getOrCreateRoot calls (independent store instances, simulating a race) return the identical token', () => {
  const path = tempPath();
  const a = createRootTokenStore({ path }).getOrCreateRoot();
  const b = createRootTokenStore({ path }).getOrCreateRoot();
  expect(a).toBe(b);
  expect(a).toHaveLength(64);
});

test('if the file pre-exists, getOrCreateRoot returns the existing token and never overwrites it', () => {
  const path = tempPath();
  const pre = createRootTokenStore({ path }).getOrCreateRoot();
  const before = statSync(path).mtimeMs;

  const got = createRootTokenStore({ path }).getOrCreateRoot();

  expect(got).toBe(pre);
  expect(statSync(path).mtimeMs).toBe(before); // file was never rewritten
});
