import { expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MemoryStore } from '../../src/memory/store.ts';
import type { JobStore } from '../../src/queue/store.ts';
import { buildFetch, type ServerDeps } from '../../src/server/app.ts';
import type { RunBuilderTurn } from '../../src/server/builders/build.ts';
import type { RunChatTurn } from '../../src/server/chat/run-turn.ts';
import { createConsentRegistry } from '../../src/server/consent/registry.ts';
import type { RunCrewTurn } from '../../src/server/crews/run.ts';
import { createMcpMountStatus } from '../../src/server/mcp/mount-status.ts';
import type { RunWorkflowTurn } from '../../src/server/workflows/run.ts';
import type { SessionStore } from '../../src/session/store.ts';
import { makeFakePool } from './_fake-pool.ts';

const TOKEN = 'a'.repeat(64);
const uploadsDir = mkdtempSync(join(tmpdir(), 'phase5-memory-uploads-'));
const runsRoot = mkdtempSync(join(tmpdir(), 'phase5-memory-runs-'));
writeFileSync(join(uploadsDir, 'abc.md'), '# hi');
const unusedRunChatTurn: RunChatTurn = async () => {
  throw new Error('runChatTurn should not be invoked by these tests');
};
const unusedRunCrewTurn: RunCrewTurn = async () => {
  throw new Error('runCrewTurn should not be invoked by these tests');
};
const unusedRunWorkflowTurn: RunWorkflowTurn = async () => {
  throw new Error('runWorkflowTurn should not be invoked by these tests');
};
const unusedRunBuilderTurn: RunBuilderTurn = async () => {
  throw new Error('runBuilderTurn should not be invoked by these tests');
};
const fakeMemoryStore = {
  stats: async () => ({ default: 1 }),
  recall: async () => [
    { id: 'd#0', source: 'd.md', text: 'hi', score: 1, namespace: '' },
  ],
  ingest: async () => ({ chunks: 1, skipped: false }),
} as unknown as MemoryStore;

// None of these tests exercise a session route either — same throwing-stub
// discipline used elsewhere for stores this test file doesn't exercise.
const unusedSessionStore = {
  listSessions: () => {
    throw new Error('sessionStore should not be invoked by these tests');
  },
  getSession: () => {
    throw new Error('sessionStore should not be invoked by these tests');
  },
  upsertSession: () => {
    throw new Error('sessionStore should not be invoked by these tests');
  },
  renameSession: () => {
    throw new Error('sessionStore should not be invoked by these tests');
  },
  deleteSession: () => {
    throw new Error('sessionStore should not be invoked by these tests');
  },
  appendMessage: () => {
    throw new Error('sessionStore should not be invoked by these tests');
  },
  getMessages: () => {
    throw new Error('sessionStore should not be invoked by these tests');
  },
  close: () => {},
} as unknown as SessionStore;

function mcpConfigPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'phase5-memory-mcp-'));
  const path = join(dir, 'mcp.json');
  writeFileSync(path, JSON.stringify({ mcpServers: {} }));
  return path;
}

function deps(): ServerDeps {
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
    memoryStore: fakeMemoryStore,
    sessionStore: unusedSessionStore,
    jobStore: {} as unknown as JobStore,
    pool: makeFakePool(),
  };
}

function authGet(path: string): Request {
  return new Request(`http://localhost:0${path}`, {
    headers: { Authorization: `Bearer ${TOKEN}`, Host: 'localhost:0' },
  });
}
function authPost(path: string, body: unknown): Request {
  return new Request(`http://localhost:0${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Host: 'localhost:0',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

test('unauthenticated requests to all three memory routes are 401 (perimeter gate)', async () => {
  const fetch = buildFetch(deps());
  const noAuth = (path: string, init?: RequestInit): Request =>
    new Request(`http://localhost:0${path}`, {
      ...init,
      headers: { Host: 'localhost:0', ...(init?.headers ?? {}) },
    });
  expect((await fetch(noAuth('/api/memory/spaces'))).status).toBe(401);
  expect(
    (
      await fetch(
        noAuth('/api/memory/default/recall', { method: 'POST', body: '{}' }),
      )
    ).status,
  ).toBe(401);
  expect(
    (
      await fetch(
        noAuth('/api/memory/default/ingest', { method: 'POST', body: '{}' }),
      )
    ).status,
  ).toBe(401);
});

test('GET /api/memory/spaces, POST recall + ingest are wired', async () => {
  const fetch = buildFetch(deps());
  const spacesRes = await fetch(authGet('/api/memory/spaces'));
  expect(spacesRes.status).toBe(200);
  expect(await spacesRes.json()).toEqual([{ name: 'default', chunkCount: 1 }]);

  const recallRes = await fetch(
    authPost('/api/memory/default/recall', { query: 'hi' }),
  );
  expect(recallRes.status).toBe(200);
  expect(await recallRes.json()).toEqual([
    { id: 'd#0', source: 'd.md', text: 'hi', score: 1 },
  ]);

  const ingestRes = await fetch(
    authPost('/api/memory/default/ingest', { fileId: 'abc.md' }),
  );
  expect(ingestRes.status).toBe(200);
  expect(await ingestRes.json()).toEqual({ chunks: 1, skipped: false });
});

test(':space param routes do not shadow the exact-match /api/memory/spaces route', async () => {
  const fetch = buildFetch(deps());
  // A literal space segment named "spaces" only collides if a sub-path like
  // /recall or /ingest follows it — /api/memory/spaces itself is matched as
  // the exact-string route first, per app.ts's registration order.
  const res = await fetch(
    authPost('/api/memory/spaces/recall', { query: 'hi' }),
  );
  expect(res.status).toBe(200);
});
