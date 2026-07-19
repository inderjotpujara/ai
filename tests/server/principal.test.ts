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
import { createTokenGuard } from '../../src/server/security/token.ts';
import type { RunWorkflowTurn } from '../../src/server/workflows/run.ts';
import type { SessionStore } from '../../src/session/store.ts';
import { ATTR } from '../../src/telemetry/spans.ts';
import { registerTestProvider } from '../helpers/otel-test-provider.ts';
import { makeFakePool } from './_fake-pool.ts';

test('createTokenGuard().principal() resolves the seam value (local, until Increment 5 session tokens)', () => {
  const guard = createTokenGuard('a'.repeat(64));
  const req = new Request('http://localhost:4130/api/health');
  expect(guard.principal(req)).toBe('local');
});

const TOKEN = 'b'.repeat(64);
const policy = { port: 0, allowedOrigins: [] as string[] };
const uploadsDir = mkdtempSync(join(tmpdir(), 'principal-uploads-'));
const runsRoot = mkdtempSync(join(tmpdir(), 'principal-runs-'));
const unusedRunChatTurn: RunChatTurn = async () => {
  throw new Error('runChatTurn should not be invoked by this test');
};
const unusedRunCrewTurn: RunCrewTurn = async () => {
  throw new Error('runCrewTurn should not be invoked by this test');
};
const unusedRunWorkflowTurn: RunWorkflowTurn = async () => {
  throw new Error('runWorkflowTurn should not be invoked by this test');
};
const unusedRunBuilderTurn: RunBuilderTurn = async () => {
  throw new Error('runBuilderTurn should not be invoked by this test');
};
const unusedMountOne: ServerDeps['mountOne'] = async () => {
  throw new Error('mountOne should not be invoked by this test');
};
const unusedMemoryStore = {} as unknown as MemoryStore;
const unusedSessionStore = { close: () => {} } as unknown as SessionStore;
const unusedJobStore = {} as unknown as JobStore;
const unusedPool = makeFakePool();
const mcpConfigPath = join(
  mkdtempSync(join(tmpdir(), 'principal-mcp-')),
  'mcp.json',
);
writeFileSync(mcpConfigPath, JSON.stringify({ mcpServers: {} }));
const deps: ServerDeps = {
  token: TOKEN,
  policy,
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
  mcpConfigPath,
  mcpMountStatus: createMcpMountStatus(),
  mountOne: unusedMountOne,
  memoryStore: unusedMemoryStore,
  sessionStore: unusedSessionStore,
  jobStore: unusedJobStore,
  pool: unusedPool,
};

let server: ReturnType<typeof Bun.serve>;
let base: string;
let ctx: ReturnType<typeof registerTestProvider>;

beforeAll(() => {
  ctx = registerTestProvider();
  server = Bun.serve({ port: 0, fetch: buildFetch(deps), idleTimeout: 0 });
  const { port } = server;
  if (port === undefined)
    throw new Error('server did not bind an ephemeral port');
  policy.port = port;
  base = `http://localhost:${port}`;
});
afterAll(() => server.stop(true));

test('a verified request threads guard.principal() into the server.request span', async () => {
  const res = await fetch(`${base}/api/health`, {
    headers: { authorization: `Bearer ${TOKEN}` },
  });
  expect(res.status).toBe(200);
  const span = ctx.exporter
    .getFinishedSpans()
    .find((s) => s.name === 'server.request');
  expect(span?.attributes[ATTR.SERVER_PRINCIPAL]).toBe('local');
});
