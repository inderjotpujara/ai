import { afterAll, beforeAll, expect, test } from 'bun:test';
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
const policy = { port: 0, allowedOrigins: [] as string[] };
const uploadsDir = mkdtempSync(join(tmpdir(), 'hooks-uploads-'));
const runsRoot = mkdtempSync(join(tmpdir(), 'hooks-runs-'));
const unusedThrow = (label: string) => async (): Promise<never> => {
  throw new Error(`${label} should not be invoked by these tests`);
};
const mcpConfigPath = join(
  mkdtempSync(join(tmpdir(), 'hooks-mcp-')),
  'mcp.json',
);
writeFileSync(mcpConfigPath, JSON.stringify({ mcpServers: {} }));

// The trigger store never resolves this token, so a well-formed POST reaches
// handleWebhook and misses → 404 (NOT 401): proof the route sits OUTSIDE the
// session guard (no bearer required) yet still inside the Host/Origin perimeter.
const deps: ServerDeps = {
  token: TOKEN,
  policy,
  recordIo: false,
  indexHtml: '<!doctype html><title>t</title>',
  runChatTurn: unusedThrow('runChatTurn') as unknown as RunChatTurn,
  consent: createConsentRegistry(),
  uploadsDir,
  runsRoot,
  runCrewTurn: unusedThrow('runCrewTurn') as unknown as RunCrewTurn,
  runWorkflowTurn: unusedThrow('runWorkflowTurn') as unknown as RunWorkflowTurn,
  runBuilderTurn: unusedThrow('runBuilderTurn') as unknown as RunBuilderTurn,
  runModelPull: async () => {},
  freeDiskBytes: async () => Number.MAX_SAFE_INTEGER,
  mcpConfigPath,
  mcpMountStatus: createMcpMountStatus(),
  mountOne: unusedThrow('mountOne') as unknown as ServerDeps['mountOne'],
  memoryStore: {} as unknown as MemoryStore,
  sessionStore: { close: () => {} } as unknown as SessionStore,
  jobStore: {} as unknown as JobStore,
  pool: makeFakePool(),
  triggers: {
    store: { getByTokenHash: () => undefined },
    secretStore: {
      get: () => {
        throw new Error('secretStore should not be invoked by these tests');
      },
    },
    fire: async () => {
      throw new Error('fire should not be invoked by these tests');
    },
  } as unknown as ServerDeps['triggers'],
};

let server: ReturnType<typeof Bun.serve>;
let base: string;

beforeAll(() => {
  server = Bun.serve({ port: 0, fetch: buildFetch(deps), idleTimeout: 0 });
  const { port } = server;
  if (port === undefined)
    throw new Error('server did not bind an ephemeral port');
  policy.port = port;
  base = `http://localhost:${port}`;
});
afterAll(() => server.stop(true));

test('POST /hooks/:token is fronted by the perimeter (forbidden Origin → 403)', async () => {
  const res = await fetch(`${base}/hooks/tok_unknown`, {
    method: 'POST',
    body: 'payload',
    headers: { origin: 'https://evil.example.com' },
  });
  expect(res.status).toBe(403);
});

test('POST /hooks/:token routes to handleWebhook with NO bearer (unknown token → 404, not 401)', async () => {
  // A loopback POST carrying no Authorization header must reach the webhook
  // handler (which authenticates via token/HMAC, not the session bearer). An
  // unknown token misses in the trigger store → 404. A 401 here would mean the
  // route was wrongly placed behind the /api session guard.
  const res = await fetch(`${base}/hooks/tok_unknown`, {
    method: 'POST',
    body: 'payload',
  });
  expect(res.status).toBe(404);
});

test('GET /hooks/:token is not the webhook receiver (only POST) — falls through', async () => {
  // Only POST matches the hook branch; a GET falls through to serveStatic and
  // never reaches handleWebhook (so the secretStore/fire throwers stay quiet).
  const res = await fetch(`${base}/hooks/tok_unknown`);
  expect(res.status).not.toBe(403);
  expect([200, 404]).toContain(res.status);
});
