import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RemoteAgent } from '../../src/a2a/client.ts';
import { createRemoteStore } from '../../src/a2a/remotes.ts';
import { setLogSink } from '../../src/log/logger.ts';

afterEach(() => {
  setLogSink(undefined);
});

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
    skillId: 'summarize',
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

test('the store round-trips the target skillId across a file reload (two-box defect fix)', () => {
  const path = tempPath();
  createRemoteStore({ path }).add(remote({ skillId: 'deep-research' }));
  // In-memory round-trip.
  expect(createRemoteStore({ path }).get('peer')?.skillId).toBe(
    'deep-research',
  );
  // The skillId is persisted to the file (it is NOT secret — unlike token, it
  // may live in the DTO/logs).
  const raw = readFileSync(path, 'utf8');
  expect(raw).toContain('deep-research');
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

test('load drops a legacy skillId-less record but warns exactly once (review minor 1)', () => {
  const path = tempPath();
  const legacy = { ...remote({ name: 'old-peer' }) } as Partial<RemoteAgent>;
  delete legacy.skillId;
  writeFileSync(path, JSON.stringify([remote({ name: 'good-peer' }), legacy]));

  const lines: string[] = [];
  setLogSink((l) => lines.push(l));

  const store = createRemoteStore({ path });

  expect(store.list().map((r) => r.name)).toEqual(['good-peer']);
  const records = lines.map((l) => JSON.parse(l));
  const warnings = records.filter((r) => r.level === 'warn');
  expect(warnings).toHaveLength(1);
  expect(warnings[0]?.msg).toContain('1 legacy remote');
  expect(warnings[0]?.msg).toMatch(
    /dropped 1 legacy remote\(s\) lacking skillId — re-add them/,
  );
});

test('load does not warn when zero legacy records are dropped', () => {
  const path = tempPath();
  writeFileSync(path, JSON.stringify([remote({ name: 'good-peer' })]));

  const lines: string[] = [];
  setLogSink((l) => lines.push(l));

  createRemoteStore({ path });

  const warnings = lines
    .map((l) => JSON.parse(l))
    .filter((r) => r.level === 'warn');
  expect(warnings).toHaveLength(0);
});

test('an absent store file is a legitimate empty list, not an error', () => {
  const store = tempStore();
  expect(store.list()).toEqual([]);
});

test('add rejects a peer-controlled name with a space/newline (§7.3, capstone B6)', () => {
  const store = tempStore();
  expect(() => store.add(remote({ name: 'evil peer' }))).toThrow(
    /invalid remote name/,
  );
  expect(() => store.add(remote({ name: 'line\ninject' }))).toThrow(
    /invalid remote name/,
  );
  // A hostile name never reached disk — the store stays empty.
  expect(store.list()).toEqual([]);
  // A conforming name still persists.
  store.add(remote({ name: 'good_peer-1' }));
  expect(store.list().map((r) => r.name)).toEqual(['good_peer-1']);
});
