import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChatRole } from '../../src/contracts/enums.ts';
import { handleSessionDetail } from '../../src/server/sessions/detail.ts';
import {
  createSessionStore,
  type SessionStore,
} from '../../src/session/store.ts';

function makeStore(): { store: SessionStore; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'sessions-detail-'));
  return { store: createSessionStore({ path: dir }, {}), dir };
}

test('404s for an unknown session id', () => {
  const { store, dir } = makeStore();
  try {
    const res = handleSessionDetail('nope', { sessionStore: store });
    expect(res.status).toBe(404);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns the full transcript, mapping stored parts to ChatMessageDTO.text', async () => {
  const { store, dir } = makeStore();
  try {
    store.upsertSession('s1', { defaultTitle: 'New chat', at: 1_000 });
    store.appendMessage(
      's1',
      {
        id: 'm1',
        role: ChatRole.User,
        parts: [{ type: 'text', text: 'hello' }],
      },
      1_000,
    );
    store.appendMessage(
      's1',
      {
        id: 'm2',
        role: ChatRole.Assistant,
        parts: [{ type: 'text', text: 'hi there' }],
        degraded: true,
      },
      2_000,
    );
    const res = handleSessionDetail('s1', { sessionStore: store });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      id: string;
      messages: {
        id: string;
        role: string;
        text: string;
        degraded?: boolean;
      }[];
    };
    expect(body.id).toBe('s1');
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0]).toEqual({
      id: 'm1',
      role: 'user',
      text: 'hello',
    });
    expect(body.messages[1]).toEqual({
      id: 'm2',
      role: 'assistant',
      text: 'hi there',
      degraded: true,
    });
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a session with no messages yet returns an empty transcript, not an error', async () => {
  const { store, dir } = makeStore();
  try {
    store.upsertSession('s1', { defaultTitle: 'New chat', at: 1_000 });
    const res = handleSessionDetail('s1', { sessionStore: store });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { messages: unknown[] };
    expect(body.messages).toEqual([]);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a malformed/unexpected stored parts shape degrades to empty text, never throws', async () => {
  const { store, dir } = makeStore();
  try {
    store.upsertSession('s1', { defaultTitle: 'New chat', at: 1_000 });
    // Simulate a corrupt/legacy row: parts is not the expected array shape.
    store.appendMessage(
      's1',
      { id: 'm1', role: ChatRole.User, parts: { unexpected: true } },
      1_000,
    );
    const res = handleSessionDetail('s1', { sessionStore: store });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { messages: { text: string }[] };
    expect(body.messages[0]?.text).toBe('');
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
