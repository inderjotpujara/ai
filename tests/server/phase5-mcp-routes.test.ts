import { expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
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

const TOKEN = 'a'.repeat(64);
const uploadsDir = mkdtempSync(join(tmpdir(), 'phase5-mcp-uploads-'));
const runsRoot = mkdtempSync(join(tmpdir(), 'phase5-mcp-runs-'));
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

function mcpConfigPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'phase5-mcp-config-'));
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
    memoryStore: unusedMemoryStore,
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

test('GET /api/mcp, POST /api/mcp/add, POST /api/mcp/test-mount are wired', async () => {
  const fetch = buildFetch(deps());
  expect((await fetch(authGet('/api/mcp'))).status).toBe(200);
  const add = await fetch(
    authPost('/api/mcp/add', { name: 'gh', server: { command: 'bun' } }),
  );
  expect(add.status).toBe(200);
  const testMount = await fetch(
    authPost('/api/mcp/test-mount', { name: 'gh' }),
  );
  expect(testMount.status).toBe(200);
});

test('/api/mcp routes are perimeter-gated (401 without a token)', async () => {
  const fetch = buildFetch(deps());
  const noAuth = (path: string, init: RequestInit = {}) =>
    new Request(`http://localhost:0${path}`, {
      ...init,
      headers: { ...init.headers, Host: 'localhost:0' },
    });
  expect((await fetch(noAuth('/api/mcp'))).status).toBe(401);
  expect(
    (
      await fetch(
        noAuth('/api/mcp/add', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'gh', server: { command: 'bun' } }),
        }),
      )
    ).status,
  ).toBe(401);
  expect(
    (
      await fetch(
        noAuth('/api/mcp/test-mount', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'gh' }),
        }),
      )
    ).status,
  ).toBe(401);
});
