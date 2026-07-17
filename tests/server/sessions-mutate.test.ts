import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleSessionDelete } from '../../src/server/sessions/delete.ts';
import { handleSessionRename } from '../../src/server/sessions/rename.ts';
import {
  createSessionStore,
  type SessionStore,
} from '../../src/session/store.ts';

function makeStore(): { store: SessionStore; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'sessions-mutate-'));
  return { store: createSessionStore({ path: dir }, {}), dir };
}

function patchRequest(body: unknown): Request {
  return new Request('http://localhost/api/sessions/s1', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('PATCH renames an existing session and returns {ok:true}', async () => {
  const { store, dir } = makeStore();
  try {
    store.upsertSession('s1', { defaultTitle: 'New chat', at: 1_000 });
    const res = await handleSessionRename(
      patchRequest({ title: 'Renamed' }),
      { sessionStore: store },
      's1',
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(store.getSession('s1')?.title).toBe('Renamed');
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('PATCH on an unknown session id 404s (never renames a phantom row)', async () => {
  const { store, dir } = makeStore();
  try {
    const res = await handleSessionRename(
      patchRequest({ title: 'Renamed' }),
      { sessionStore: store },
      'nope',
    );
    expect(res.status).toBe(404);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('PATCH with a bad body (empty title) 400s', async () => {
  const { store, dir } = makeStore();
  try {
    store.upsertSession('s1', { defaultTitle: 'New chat', at: 1_000 });
    const res = await handleSessionRename(
      patchRequest({ title: '' }),
      { sessionStore: store },
      's1',
    );
    expect(res.status).toBe(400);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('PATCH with a non-JSON body 400s', async () => {
  const { store, dir } = makeStore();
  try {
    store.upsertSession('s1', { defaultTitle: 'New chat', at: 1_000 });
    const res = await handleSessionRename(
      new Request('http://localhost/api/sessions/s1', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: 'not json',
      }),
      { sessionStore: store },
      's1',
    );
    expect(res.status).toBe(400);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('DELETE removes a session and its messages (cascade), returning {ok:true}', () => {
  const { store, dir } = makeStore();
  try {
    store.upsertSession('s1', { defaultTitle: 'New chat', at: 1_000 });
    store.appendMessage('s1', { id: 'm1', role: 'user', parts: [] }, 1_000);
    const res = handleSessionDelete({ sessionStore: store }, 's1');
    expect(res.status).toBe(200);
    expect(store.getSession('s1')).toBeUndefined();
    expect(store.getMessages('s1')).toEqual([]);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('DELETE on an unknown session id 404s', () => {
  const { store, dir } = makeStore();
  try {
    const res = handleSessionDelete({ sessionStore: store }, 'nope');
    expect(res.status).toBe(404);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
