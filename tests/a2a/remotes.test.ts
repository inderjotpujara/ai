import { expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RemoteAgent } from '../../src/a2a/client.ts';
import { createRemoteStore } from '../../src/a2a/remotes.ts';

function tempPath(): string {
  return join(mkdtempSync(join(tmpdir(), 'a2a-remotes-')), 'a2a-remotes.json');
}

function tempStore() {
  return createRemoteStore({ path: tempPath() });
}

function remote(overrides: Partial<RemoteAgent> = {}): RemoteAgent {
  return {
    name: 'peer',
    baseUrl: 'https://peer.ts.net/api/a2a',
    cardUrl: 'https://peer.ts.net/.well-known/agent-card.json',
    token: 'SUPER_SECRET_BEARER',
    pinnedCardHash: 'deadbeef',
    ...overrides,
  };
}

test('the store round-trips a remote (add → list/get)', () => {
  const store = tempStore();
  store.add(remote());
  const items = store.list();
  expect(items).toHaveLength(1);
  expect(items[0]).toEqual(remote());
  expect(store.get('peer')).toEqual(remote());
  expect(store.get('nope')).toBeUndefined();
});

test('add upserts on a duplicate name (no duplicate rows)', () => {
  const store = tempStore();
  store.add(remote({ pinnedCardHash: 'old' }));
  store.add(remote({ pinnedCardHash: 'new' }));
  const items = store.list();
  expect(items).toHaveLength(1);
  expect(items[0]?.pinnedCardHash).toBe('new');
});

test('remove drops one remote by name', () => {
  const store = tempStore();
  store.add(remote({ name: 'a' }));
  store.add(remote({ name: 'b' }));
  store.remove('a');
  expect(store.list().map((r) => r.name)).toEqual(['b']);
});

test('the persisted file is 0600 and the token is stored in it (never stripped on write)', () => {
  const path = tempPath();
  const store = createRemoteStore({ path });
  store.add(remote());
  const mode = statSync(path).mode & 0o777;
  expect(mode).toBe(0o600);
  // The token DOES live in the file — this is the one place it's allowed.
  const raw = readFileSync(path, 'utf8');
  expect(raw).toContain('SUPER_SECRET_BEARER');
});

test('a fresh store over the same file sees a persisted add', () => {
  const path = tempPath();
  createRemoteStore({ path }).add(remote());
  const reopened = createRemoteStore({ path });
  expect(reopened.list().map((r) => r.name)).toEqual(['peer']);
});

test('a corrupt store file fails closed (throws at construction)', () => {
  const path = tempPath();
  writeFileSync(path, '{ not json');
  expect(() => createRemoteStore({ path })).toThrow();
});

test('a non-array store file fails closed (throws at construction)', () => {
  const path = tempPath();
  writeFileSync(path, '{"name":"x"}');
  expect(() => createRemoteStore({ path })).toThrow();
});

test('an absent store file is a legitimate empty list, not an error', () => {
  const store = tempStore();
  expect(store.list()).toEqual([]);
});
