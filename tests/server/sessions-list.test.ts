import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleSessionList } from '../../src/server/sessions/list.ts';
import {
  createSessionStore,
  type SessionStore,
} from '../../src/session/store.ts';

function makeStore(): { store: SessionStore; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'sessions-list-'));
  return { store: createSessionStore({ path: dir }, {}), dir };
}

test('GET /api/sessions returns an empty page for an empty store', async () => {
  const { store, dir } = makeStore();
  try {
    const res = handleSessionList(new URLSearchParams(), {
      sessionStore: store,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ items: [], total: 0 });
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('lists sessions, honoring search + limit (delegates straight to SessionStore.listSessions)', async () => {
  const { store, dir } = makeStore();
  try {
    store.upsertSession('s1', {
      defaultTitle: 'Talking about cats',
      at: 1_000,
    });
    store.upsertSession('s2', {
      defaultTitle: 'Talking about dogs',
      at: 2_000,
    });
    const res = handleSessionList(
      new URLSearchParams({ search: 'cats', limit: '10' }),
      { sessionStore: store },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: { id: string }[];
      total: number;
    };
    expect(body.items.map((i) => i.id)).toEqual(['s1']);
    expect(body.total).toBe(1);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a malformed limit (non-numeric) is rejected with 400, not a 500', () => {
  const { store, dir } = makeStore();
  try {
    const res = handleSessionList(new URLSearchParams({ limit: 'abc' }), {
      sessionStore: store,
    });
    expect(res.status).toBe(400);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a limit above the 200 ceiling is rejected with 400', () => {
  const { store, dir } = makeStore();
  try {
    const res = handleSessionList(new URLSearchParams({ limit: '500' }), {
      sessionStore: store,
    });
    expect(res.status).toBe(400);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
