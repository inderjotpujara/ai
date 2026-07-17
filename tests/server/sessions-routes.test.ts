import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MemoryStore } from '../../src/memory/store.ts';
import { buildFetch, type ServerDeps } from '../../src/server/app.ts';
import type { RunBuilderTurn } from '../../src/server/builders/build.ts';
import type { RunChatTurn } from '../../src/server/chat/run-turn.ts';
import { createConsentRegistry } from '../../src/server/consent/registry.ts';
import type { RunCrewTurn } from '../../src/server/crews/run.ts';
import { createMcpMountStatus } from '../../src/server/mcp/mount-status.ts';
import type { RunWorkflowTurn } from '../../src/server/workflows/run.ts';
import {
  createSessionStore,
  type SessionStore,
} from '../../src/session/store.ts';

const TOKEN = 'a'.repeat(64);
const uploadsDir = mkdtempSync(join(tmpdir(), 'sessions-routes-uploads-'));
const runsRoot = mkdtempSync(join(tmpdir(), 'sessions-routes-runs-'));
const unusedRunChatTurn: RunChatTurn = async () => {
  throw new Error('unused');
};
const unusedRunCrewTurn: RunCrewTurn = async () => {
  throw new Error('unused');
};
const unusedRunWorkflowTurn: RunWorkflowTurn = async () => {
  throw new Error('unused');
};
const unusedRunBuilderTurn: RunBuilderTurn = async () => {
  throw new Error('unused');
};
const unusedMemoryStore = {
  stats: async () => {
    throw new Error('unused');
  },
  recall: async () => {
    throw new Error('unused');
  },
  ingest: async () => {
    throw new Error('unused');
  },
} as unknown as MemoryStore;

function mcpConfigPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sessions-routes-mcp-'));
  const path = join(dir, 'mcp.json');
  writeFileSync(path, JSON.stringify({ mcpServers: {} }));
  return path;
}

function deps(sessionStore: SessionStore): ServerDeps {
  return {
    token: TOKEN,
    policy: { port: 0, allowedOrigins: [] as string[] },
    recordIo: false,
    indexHtml: '<!doctype html><title>t</title>',
    runChatTurn: unusedRunChatTurn,
    consent: createConsentRegistry(),
    uploadsDir,
    runsRoot,
    runCrewTurn: unusedRunCrewTurn,
    runWorkflowTurn: unusedRunWorkflowTurn,
    runBuilderTurn: unusedRunBuilderTurn,
    runModelPull: async () => {},
    freeDiskBytes: async () => Number.MAX_SAFE_INTEGER,
    mcpConfigPath: mcpConfigPath(),
    mcpMountStatus: createMcpMountStatus(),
    mountOne: async () => ({ outcome: 'mounted' }),
    memoryStore: unusedMemoryStore,
    sessionStore,
  };
}

function authGet(path: string): Request {
  return new Request(`http://localhost:0${path}`, {
    headers: { Authorization: `Bearer ${TOKEN}`, Host: 'localhost:0' },
  });
}

test('unauthenticated requests to every session route are 401 (perimeter gate)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sessions-perimeter-'));
  const store = createSessionStore({ path: dir }, {});
  try {
    const fetch = buildFetch(deps(store));
    const noAuth = (path: string, init?: RequestInit): Request =>
      new Request(`http://localhost:0${path}`, {
        ...init,
        headers: { Host: 'localhost:0', ...(init?.headers ?? {}) },
      });
    expect((await fetch(noAuth('/api/sessions'))).status).toBe(401);
    expect((await fetch(noAuth('/api/sessions/s1'))).status).toBe(401);
    expect(
      (await fetch(noAuth('/api/sessions/s1', { method: 'PATCH', body: '{}' })))
        .status,
    ).toBe(401);
    expect(
      (await fetch(noAuth('/api/sessions/s1', { method: 'DELETE' }))).status,
    ).toBe(401);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('GET /api/sessions, GET/PATCH/DELETE /api/sessions/:id are wired end-to-end', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sessions-routes-live-'));
  const store = createSessionStore({ path: dir }, {});
  try {
    store.upsertSession('s1', { defaultTitle: 'New chat', at: 1_000 });
    const fetch = buildFetch(deps(store));

    const listRes = await fetch(authGet('/api/sessions'));
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as { items: { id: string }[] };
    expect(listBody.items.map((i) => i.id)).toEqual(['s1']);

    const detailRes = await fetch(authGet('/api/sessions/s1'));
    expect(detailRes.status).toBe(200);

    const renameRes = await fetch(
      new Request('http://localhost:0/api/sessions/s1', {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          Host: 'localhost:0',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ title: 'Renamed' }),
      }),
    );
    expect(renameRes.status).toBe(200);
    expect(store.getSession('s1')?.title).toBe('Renamed');

    const deleteRes = await fetch(
      new Request('http://localhost:0/api/sessions/s1', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${TOKEN}`, Host: 'localhost:0' },
      }),
    );
    expect(deleteRes.status).toBe(200);
    expect(store.getSession('s1')).toBeUndefined();
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('GET /api/sessions/:id 404s for an unknown id', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sessions-404-'));
  const store = createSessionStore({ path: dir }, {});
  try {
    const fetch = buildFetch(deps(store));
    const res = await fetch(authGet('/api/sessions/nope'));
    expect(res.status).toBe(404);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
