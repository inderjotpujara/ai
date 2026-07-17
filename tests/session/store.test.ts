import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createSessionStore,
  type SessionStore,
} from '../../src/session/store.ts';

let dir: string;
let store: SessionStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'session-store-'));
  store = createSessionStore({ path: dir }, {});
});
afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('upsertSession / getSession', () => {
  test('upsertSession creates a session on first call', () => {
    store.upsertSession('s1', { defaultTitle: 'New chat', at: 1_000 });
    const row = store.getSession('s1');
    expect(row).toBeDefined();
    expect(row?.id).toBe('s1');
    expect(row?.title).toBe('New chat');
    expect(row?.owner).toBe('local');
    expect(row?.createdAt).toBe(1_000);
    expect(row?.updatedAt).toBe(1_000);
    expect(row?.lastMessageAt).toBeUndefined();
    expect(row?.runId).toBeUndefined();
  });

  test('getSession returns undefined for an absent id', () => {
    expect(store.getSession('nope')).toBeUndefined();
  });

  test('upsertSession is idempotent create-if-absent — a repeat call never overwrites the title', () => {
    store.upsertSession('s1', { defaultTitle: 'First title', at: 1_000 });
    store.upsertSession('s1', { defaultTitle: 'Second title', at: 2_000 });
    const row = store.getSession('s1');
    expect(row?.title).toBe('First title');
    expect(row?.createdAt).toBe(1_000);
    expect(row?.updatedAt).toBe(1_000); // untouched — the second upsert was fully ignored
  });

  test('upsertSession never throws on a repeat id (INSERT OR IGNORE, not a constraint violation)', () => {
    store.upsertSession('s1', { defaultTitle: 'A', at: 1 });
    expect(() =>
      store.upsertSession('s1', { defaultTitle: 'B', at: 2 }),
    ).not.toThrow();
  });

  test('two distinct sessions coexist independently', () => {
    store.upsertSession('s1', { defaultTitle: 'One', at: 1 });
    store.upsertSession('s2', { defaultTitle: 'Two', at: 2 });
    expect(store.getSession('s1')?.title).toBe('One');
    expect(store.getSession('s2')?.title).toBe('Two');
  });
});

describe('renameSession / deleteSession', () => {
  test('renameSession updates title and updatedAt', () => {
    store.upsertSession('s1', { defaultTitle: 'New chat', at: 1_000 });
    store.renameSession('s1', 'My renamed chat', 2_000);
    const row = store.getSession('s1');
    expect(row?.title).toBe('My renamed chat');
    expect(row?.updatedAt).toBe(2_000);
  });

  test('renameSession on an absent id is a silent no-op (never throws)', () => {
    expect(() => store.renameSession('nope', 'New title', 1)).not.toThrow();
    expect(store.getSession('nope')).toBeUndefined();
  });

  test('deleteSession removes the session row', () => {
    store.upsertSession('s1', { defaultTitle: 'New chat', at: 1_000 });
    store.deleteSession('s1');
    expect(store.getSession('s1')).toBeUndefined();
  });

  test('deleteSession on an absent id is a silent no-op (never throws)', () => {
    expect(() => store.deleteSession('nope')).not.toThrow();
  });

  // NOTE: the full cascade assertion (messages also gone) is added for real
  // in Task 7 Step 3, once appendMessage/getMessages exist — this task only
  // proves the session-row half of the delete.
});
