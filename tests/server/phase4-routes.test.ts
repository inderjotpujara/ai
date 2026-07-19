import { expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MemoryStore } from '../../src/memory/store.ts';
import { createJobStore } from '../../src/queue/store.ts';
import { buildFetch, type ServerDeps } from '../../src/server/app.ts';
import type { RunChatTurn } from '../../src/server/chat/run-turn.ts';
import { createConsentRegistry } from '../../src/server/consent/registry.ts';
import { createMcpMountStatus } from '../../src/server/mcp/mount-status.ts';
import type { SessionStore } from '../../src/session/store.ts';
import { makeFakePool } from './_fake-pool.ts';

// None of these tests exercise a memory route, so a throwing fake keeps the
// fixture honest about what's actually under test here.
const unusedMemoryStore = {
  stats: async () => {
    throw new Error('memoryStore should not be invoked by these tests');
  },
  recall: async () => {
    throw new Error('memoryStore should not be invoked by these tests');
  },
  ingest: async () => {
    throw new Error('memoryStore should not be invoked by these tests');
  },
} as unknown as MemoryStore;

// None of these tests exercise a session route either — same throwing-stub
// discipline as unusedMemoryStore above.
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

const TOKEN = 'a'.repeat(64);
// None of these tests exercise POST /api/upload or an /api/chat body with
// uploadIds, so a plain (never-read) confined dir suffices.
const uploadsDir = mkdtempSync(join(tmpdir(), 'phase4-uploads-'));
// None of these tests exercise a Runs endpoint, so a plain (never-read)
// confined dir suffices here too.
const runsRoot = mkdtempSync(join(tmpdir(), 'phase4-runs-'));
// None of these tests exercise POST /api/chat — a fake that throws if ever
// invoked keeps the fixtures honest about what's actually under test here.
const unusedRunChatTurn: RunChatTurn = async () => {
  throw new Error('runChatTurn should not be invoked by these tests');
};
// None of these tests exercise /api/mcp routes either, so a bare
// never-populated mcp.json suffices.
const mcpConfigPath = join(
  mkdtempSync(join(tmpdir(), 'phase4-mcp-')),
  'mcp.json',
);
writeFileSync(mcpConfigPath, JSON.stringify({ mcpServers: {} }));

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
    runCrewTurn: async () => {},
    runWorkflowTurn: async () => {},
    runBuilderTurn: async () => ({ kind: 'declined' }),
    runModelPull: async () => {},
    freeDiskBytes: async () => Number.MAX_SAFE_INTEGER,
    mcpConfigPath,
    mcpMountStatus: createMcpMountStatus(),
    mountOne: async () => ({ outcome: 'mounted' }),
    memoryStore: unusedMemoryStore,
    sessionStore: unusedSessionStore,
    jobStore: createJobStore(
      { path: mkdtempSync(join(tmpdir(), 'phase4-jobs-')) },
      {},
    ),
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

test('GET /api/crews and /api/workflows route to their handlers', async () => {
  const fetch = buildFetch(deps());
  expect((await fetch(authGet('/api/crews'))).status).toBe(200);
  expect((await fetch(authGet('/api/workflows'))).status).toBe(200);
  expect((await fetch(authGet('/api/crews/research-crew'))).status).toBe(200);
  expect(
    (await fetch(authGet('/api/workflows/fetch-then-summarize'))).status,
  ).toBe(200);
  expect((await fetch(authGet('/api/crews/nope'))).status).toBe(404);
});

test('POST /api/crews/research-crew/run routes to the launch handler', async () => {
  const fetch = buildFetch(deps());
  const res = await fetch(
    authPost('/api/crews/research-crew/run', { input: 'AI' }),
  );
  expect(res.status).toBe(200);
  const { runId } = (await res.json()) as { runId: string };
  expect(runId.startsWith('run-')).toBe(true);
});

test('POST /api/workflows/fetch-then-summarize/run routes to the launch handler', async () => {
  const fetch = buildFetch(deps());
  const res = await fetch(
    authPost('/api/workflows/fetch-then-summarize/run', { input: 'AI' }),
  );
  expect(res.status).toBe(200);
  const { runId } = (await res.json()) as { runId: string };
  expect(runId.startsWith('run-')).toBe(true);
});
