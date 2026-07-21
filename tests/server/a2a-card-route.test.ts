import { afterAll, afterEach, beforeAll, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createA2aAllowlist } from '../../src/a2a/allowlist.ts';
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

const CARD_PATH = '/.well-known/agent-card.json';
const policy = { port: 0, allowedOrigins: [] as string[] };
// The no-a2a server binds a DIFFERENT ephemeral port, so it needs its OWN
// perimeter policy (the Host-header port check keys on policy.port).
const policyNoA2a = { port: 0, allowedOrigins: [] as string[] };
const uploadsDir = mkdtempSync(join(tmpdir(), 'a2a-card-uploads-'));
const runsRoot = mkdtempSync(join(tmpdir(), 'a2a-card-runs-'));
const skillsPath = join(
  mkdtempSync(join(tmpdir(), 'a2a-card-skills-')),
  's.json',
);
const mcpConfigPath = join(
  mkdtempSync(join(tmpdir(), 'a2a-card-mcp-')),
  'mcp.json',
);
writeFileSync(mcpConfigPath, JSON.stringify({ mcpServers: {} }));

const unusedThrow = (label: string) => async (): Promise<never> => {
  throw new Error(`${label} should not be invoked by these tests`);
};

// Empty allowlist (no store file yet) → the card advertises `skills: []`, which
// is all these route-level tests need; skill exposure is exercised in Task 4/5.
const allowlist = createA2aAllowlist({ path: skillsPath });

const baseDeps = {
  token: 'a'.repeat(64),
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
  publicBaseUrl: 'http://agent.local',
} satisfies Omit<ServerDeps, 'a2a'>;

// Wired-a2a server (the real route under test).
const deps: ServerDeps = { ...baseDeps, a2a: { allowlist } };
// A server WITHOUT the a2a dep — proves the fail-safe 503 degrade.
const depsNoA2a: ServerDeps = { ...baseDeps, policy: policyNoA2a };

let server: ReturnType<typeof Bun.serve>;
let base: string;
let serverNoA2a: ReturnType<typeof Bun.serve>;
let baseNoA2a: string;

beforeAll(() => {
  server = Bun.serve({ port: 0, fetch: buildFetch(deps), idleTimeout: 0 });
  if (server.port === undefined) throw new Error('server did not bind a port');
  policy.port = server.port;
  base = `http://localhost:${server.port}`;

  serverNoA2a = Bun.serve({
    port: 0,
    fetch: buildFetch(depsNoA2a),
    idleTimeout: 0,
  });
  if (serverNoA2a.port === undefined)
    throw new Error('serverNoA2a did not bind a port');
  policyNoA2a.port = serverNoA2a.port;
  baseNoA2a = `http://localhost:${serverNoA2a.port}`;
});
afterAll(() => {
  server.stop(true);
  serverNoA2a.stop(true);
});
afterEach(() => {
  delete process.env.AGENT_A2A_ENABLED;
  delete process.env.AGENT_A2A_CARD_TTL;
});

test('card route 404s when AGENT_A2A_ENABLED is off (fail-safe: discovery reveals nothing)', async () => {
  delete process.env.AGENT_A2A_ENABLED; // default-off
  const res = await fetch(`${base}${CARD_PATH}`);
  expect(res.status).toBe(404);
  await res.text();
});

test('card route serves the card + ETag + Cache-Control when enabled, with NO Authorization header', async () => {
  process.env.AGENT_A2A_ENABLED = '1';
  process.env.AGENT_A2A_CARD_TTL = '120';
  // No Authorization header on purpose: public discovery must NOT require the
  // session bearer (a 401 here would mean the route was wrongly placed behind
  // the /api guard).
  const res = await fetch(`${base}${CARD_PATH}`);
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toContain('application/json');
  expect(res.headers.get('etag')).toBeTruthy();
  expect(res.headers.get('cache-control')).toBe('public, max-age=120');
  const card = (await res.json()) as { protocolVersion: string; url: string };
  expect(card.protocolVersion).toBe('1.0');
  expect(card.url).toBe('http://agent.local/api/a2a');
});

test('If-None-Match matching the ETag returns 304', async () => {
  process.env.AGENT_A2A_ENABLED = '1';
  const first = await fetch(`${base}${CARD_PATH}`);
  expect(first.status).toBe(200);
  const etag = first.headers.get('etag');
  expect(etag).toBeTruthy();
  await first.text();

  const second = await fetch(`${base}${CARD_PATH}`, {
    headers: { 'if-none-match': etag as string },
  });
  expect(second.status).toBe(304);
  await second.text();
});

test('card route 503s when the a2a dep is not wired (degrade, not 500)', async () => {
  process.env.AGENT_A2A_ENABLED = '1';
  const res = await fetch(`${baseNoA2a}${CARD_PATH}`);
  expect(res.status).toBe(503);
  await res.text();
});
