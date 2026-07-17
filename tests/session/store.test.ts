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

  test('deleteSession cascades — messages are gone too', () => {
    store.upsertSession('s1', { defaultTitle: 'New chat', at: 1_000 });
    store.appendMessage(
      's1',
      { id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hi' }] },
      1_000,
    );
    expect(store.getMessages('s1')).toHaveLength(1);

    store.deleteSession('s1');

    expect(store.getSession('s1')).toBeUndefined();
    expect(store.getMessages('s1')).toHaveLength(0);
  });
});

describe('appendMessage / getMessages', () => {
  beforeEach(() => {
    store.upsertSession('s1', { defaultTitle: 'New chat', at: 1_000 });
  });

  test('appendMessage stores a message and touches session activity timestamps', () => {
    store.appendMessage(
      's1',
      { id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hi' }] },
      1_500,
    );
    const session = store.getSession('s1');
    expect(session?.updatedAt).toBe(1_500);
    expect(session?.lastMessageAt).toBe(1_500);

    const messages = store.getMessages('s1');
    expect(messages).toHaveLength(1);
    expect(messages[0]?.id).toBe('m1');
    expect(messages[0]?.sessionId).toBe('s1');
    expect(messages[0]?.role).toBe('user');
    expect(messages[0]?.parts).toEqual([{ type: 'text', text: 'hi' }]);
    expect(messages[0]?.parentMessageId).toBeUndefined();
    expect(messages[0]?.degraded).toBeUndefined();
  });

  test('appendMessage is idempotent — the same message id posted twice yields one row', () => {
    store.appendMessage(
      's1',
      { id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hi' }] },
      1_500,
    );
    store.appendMessage(
      's1',
      { id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hi (retry)' }] },
      1_600,
    );

    const messages = store.getMessages('s1');
    expect(messages).toHaveLength(1);
    expect(messages[0]?.parts).toEqual([{ type: 'text', text: 'hi' }]); // first write wins
  });

  test('appendMessage records parentMessageId and degraded when provided', () => {
    store.appendMessage(
      's1',
      {
        id: 'm1',
        role: 'assistant',
        parts: [{ type: 'text', text: 'a' }],
        parentMessageId: 'm0',
        degraded: true,
      },
      1_000,
    );
    const messages = store.getMessages('s1');
    expect(messages[0]?.parentMessageId).toBe('m0');
    expect(messages[0]?.degraded).toBe(true);
  });

  test('appendMessage with degraded explicitly false round-trips false, not undefined', () => {
    store.appendMessage(
      's1',
      { id: 'm1', role: 'assistant', parts: [], degraded: false },
      1_000,
    );
    expect(store.getMessages('s1')[0]?.degraded).toBe(false);
  });

  test('getMessages orders by created_at ascending regardless of insert order', () => {
    store.appendMessage(
      's1',
      {
        id: 'm2',
        role: 'assistant',
        parts: [{ type: 'text', text: 'second' }],
      },
      2_000,
    );
    store.appendMessage(
      's1',
      { id: 'm1', role: 'user', parts: [{ type: 'text', text: 'first' }] },
      1_000,
    );
    const messages = store.getMessages('s1');
    expect(messages.map((m) => m.id)).toEqual(['m1', 'm2']);
  });

  test('getMessages on a session with no messages returns an empty array', () => {
    expect(store.getMessages('s1')).toEqual([]);
  });

  test("getMessages is session-scoped — a second session's messages never leak in", () => {
    store.upsertSession('s2', { defaultTitle: 'Other chat', at: 1_000 });
    store.appendMessage('s1', { id: 'm1', role: 'user', parts: [] }, 1_000);
    store.appendMessage('s2', { id: 'm2', role: 'user', parts: [] }, 1_000);
    expect(store.getMessages('s1').map((m) => m.id)).toEqual(['m1']);
    expect(store.getMessages('s2').map((m) => m.id)).toEqual(['m2']);
  });
});
