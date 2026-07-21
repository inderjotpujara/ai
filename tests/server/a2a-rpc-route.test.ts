import { afterAll, afterEach, beforeAll, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { A2aAllowlist, ResolvedTarget } from '../../src/a2a/allowlist.ts';
import { createA2aEnrollment } from '../../src/a2a/enroll.ts';
import { createTaskIndex } from '../../src/a2a/task-index.ts';
import type { MemoryStore } from '../../src/memory/store.ts';
import type { JobStore } from '../../src/queue/store.ts';
import {
  type JobInput,
  JobKind,
  JobPriority,
  type JobRecord,
  JobStatus,
} from '../../src/queue/types.ts';
import { buildFetch, type ServerDeps } from '../../src/server/app.ts';
import type { RunBuilderTurn } from '../../src/server/builders/build.ts';
import type { RunChatTurn } from '../../src/server/chat/run-turn.ts';
import { createConsentRegistry } from '../../src/server/consent/registry.ts';
import type { RunCrewTurn } from '../../src/server/crews/run.ts';
import { createMcpMountStatus } from '../../src/server/mcp/mount-status.ts';
import { createRootTokenStore } from '../../src/server/security/root-token.ts';
import type { RunWorkflowTurn } from '../../src/server/workflows/run.ts';
import type { SessionStore } from '../../src/session/store.ts';
import { makeFakePool } from './_fake-pool.ts';

const A2A_PATH = '/api/a2a';
const policy = { port: 0, allowedOrigins: [] as string[] };
// The no-a2a server binds a DIFFERENT ephemeral port, so it needs its OWN
// perimeter policy (the Host-header port check keys on policy.port) — mirrors
// tests/server/a2a-card-route.test.ts's depsNoA2a pattern.
const policyNoA2a = { port: 0, allowedOrigins: [] as string[] };

// --- minimal in-memory a2a-server fakes (mirror tests/a2a/server.test.ts) ----

function fakeAllowlist(table: Record<string, ResolvedTarget>): A2aAllowlist {
  return {
    list: () => [],
    put: () => {},
    remove: () => {},
    resolve: (skillId: string) => table[skillId],
  };
}

function fakeJobStore(): JobStore {
  const jobs = new Map<string, JobRecord>();
  let seq = 0;
  const store = {
    enqueue(input: JobInput): JobRecord {
      const id = `job-${++seq}`;
      const rec: JobRecord = {
        id,
        kind: input.kind,
        payload: input.payload,
        priority: JobPriority.Normal,
        status: JobStatus.Queued,
        attempts: 0,
        maxAttempts: 1,
        createdAt: 0,
        updatedAt: 0,
        startedAt: undefined,
        finishedAt: undefined,
        availableAt: 0,
        runId: input.runId,
        result: undefined,
        error: undefined,
        retriedFrom: null,
        origin: input.origin,
        chainDepth: 0,
      };
      jobs.set(id, rec);
      return rec;
    },
    getJob: (id: string) => jobs.get(id),
    markCanceled: () => {},
  };
  return store as unknown as JobStore;
}

// A real A2A enrollment so the route's Task-16 Bearer gate can be satisfied with
// a genuinely-issued token (the gate now fronts every request).
const credDir = mkdtempSync(join(tmpdir(), 'a2a-rpc-cred-'));
const enrollment = createA2aEnrollment({
  rootTokens: createRootTokenStore({ path: join(credDir, 'daemon-token') }),
  registryPath: join(credDir, 'a2a-tokens.json'),
});
const bearer = enrollment.issue('rpc-route-test').token;

const uploadsDir = mkdtempSync(join(tmpdir(), 'a2a-rpc-uploads-'));
const runsRoot = mkdtempSync(join(tmpdir(), 'a2a-rpc-runs-'));
const mcpConfigPath = join(
  mkdtempSync(join(tmpdir(), 'a2a-rpc-mcp-')),
  'm.json',
);
writeFileSync(mcpConfigPath, JSON.stringify({ mcpServers: {} }));

const unusedThrow = (label: string) => async (): Promise<never> => {
  throw new Error(`${label} should not be invoked by these tests`);
};

const a2aDeps = {
  allowlist: fakeAllowlist({ ask: { kind: JobKind.Chat, ref: 'file_qa' } }),
  enrollment,
  jobStore: fakeJobStore(),
  runsRoot,
  taskIndex: createTaskIndex(),
};

const deps: ServerDeps = {
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
  jobStore: a2aDeps.jobStore,
  pool: makeFakePool(),
  publicBaseUrl: 'http://agent.local',
  a2a: a2aDeps,
};

// A server WITHOUT the a2a dep (capstone B7b) — proves the disabled-by-
// missing-dep path is the SAME featureless 404 as the disabled-by-flag path,
// not the generic need()-shaped 503 other unwired deps degrade to.
const depsNoA2a: ServerDeps = { ...deps, a2a: undefined, policy: policyNoA2a };

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
});

const rpc = (method: string, params?: unknown): string =>
  JSON.stringify({ jsonrpc: '2.0', id: 1, method, params });

/** A valid A2A Bearer + fresh replay proof — what an authenticated inbound
 *  request carries past the Task-16 gate. */
function authHeaders(): Record<string, string> {
  return {
    'content-type': 'application/json',
    authorization: `Bearer ${bearer}`,
    'x-a2a-timestamp': String(Math.floor(Date.now() / 1000)),
    'x-a2a-nonce': randomUUID(),
  };
}

test('POST /api/a2a is reachable with an A2A Bearer but NO device session token (owns its own auth)', async () => {
  process.env.AGENT_A2A_ENABLED = '1';
  // Authenticated by the A2A Bearer (NOT a device session token — D5 two-stores
  // split): the route is let past the DEVICE session guard, so a valid A2A
  // Bearer + a bad envelope reaches the handler and comes back as a JSON-RPC
  // error (HTTP 200), NEVER a 401-from-the-session-guard.
  const res = await fetch(`${base}${A2A_PATH}`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ not: 'a valid json-rpc envelope' }),
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    jsonrpc: string;
    error?: { code: number };
  };
  expect(res.status).not.toBe(401);
  expect(body.jsonrpc).toBe('2.0');
  expect(body.error?.code).toBe(-32600); // invalid request, from the handler
});

test('POST /api/a2a message/send returns a JSON-RPC response with a submitted task', async () => {
  process.env.AGENT_A2A_ENABLED = '1';
  const res = await fetch(`${base}${A2A_PATH}`, {
    method: 'POST',
    headers: authHeaders(),
    body: rpc('message/send', {
      message: {
        role: 'user',
        parts: [{ kind: 'text', text: 'summarize this' }],
        messageId: 'm1',
      },
      metadata: { skillId: 'ask' },
    }),
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    jsonrpc: string;
    id: number;
    result?: { status?: { state?: string }; kind?: string };
    error?: unknown;
  };
  expect(body.jsonrpc).toBe('2.0');
  expect(body.id).toBe(1); // same id echoed back
  expect(body.error).toBeUndefined();
  expect(body.result?.kind).toBe('task');
  expect(body.result?.status?.state).toBe('submitted');
});

test('POST /api/a2a 404s when AGENT_A2A_ENABLED is off (fail-safe)', async () => {
  delete process.env.AGENT_A2A_ENABLED; // default-off
  const res = await fetch(`${base}${A2A_PATH}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: rpc('message/send', {
      message: {
        role: 'user',
        parts: [{ kind: 'text', text: 'hi' }],
        messageId: 'm2',
      },
      metadata: { skillId: 'ask' },
    }),
  });
  expect(res.status).toBe(404);
  await res.text();
});

test('POST /api/a2a 404s (not 503) when the a2a dep is not wired — same featureless body as flag-off (capstone B7b)', async () => {
  process.env.AGENT_A2A_ENABLED = '1';
  const res = await fetch(`${baseNoA2a}${A2A_PATH}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: rpc('message/send', {
      message: {
        role: 'user',
        parts: [{ kind: 'text', text: 'hi' }],
        messageId: 'm3',
      },
      metadata: { skillId: 'ask' },
    }),
  });
  expect(res.status).toBe(404);
  const body = (await res.json()) as { error: string };
  // Featureless: no `DepUnavailableError`-shaped "server dependency not
  // configured: a2a" leak — a caller cannot tell "unconfigured" apart from
  // "disabled" or "no such route".
  expect(body.error).toBe('not found');
  expect(body.error.toLowerCase()).not.toContain('a2a');
});
