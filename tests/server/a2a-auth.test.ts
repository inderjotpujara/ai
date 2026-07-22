import { afterAll, afterEach, beforeAll, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { A2aAllowlist, ResolvedTarget } from '../../src/a2a/allowlist.ts';
import { createA2aEnrollment } from '../../src/a2a/enroll.ts';
import type { A2aServerDeps } from '../../src/a2a/server.ts';
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
import { createSessionTokenStore } from '../../src/server/security/session-token.ts';
import type { RunWorkflowTurn } from '../../src/server/workflows/run.ts';
import type { SessionStore } from '../../src/session/store.ts';
import { makeFakePool } from './_fake-pool.ts';

const A2A_PATH = '/api/a2a';
const policy = { port: 0, allowedOrigins: [] as string[] };

// --- minimal in-memory a2a-server fakes (mirror a2a-rpc-route.test.ts) --------

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

// --- real credential primitives: an A2A enrollment + a session store that SHARE
// one root, so the D5 cross-domain rejection is proven against the real crypto.
const credDir = mkdtempSync(join(tmpdir(), 'a2a-auth-cred-'));
const rootTokens = createRootTokenStore({
  path: join(credDir, 'daemon-token'),
});
const registryPath = join(credDir, 'a2a-tokens.json');
const enrollment = createA2aEnrollment({ rootTokens, registryPath });
const sessionTokens = createSessionTokenStore({
  path: join(credDir, 'sessions'),
  rootToken: () => rootTokens.getOrCreateRoot(),
});

const validA2a = enrollment.issue('remote-orchestrator').token;
const deviceToken = sessionTokens.mintSessionToken({
  deviceId: 'mac-2',
  ttlMs: 60_000,
});

const uploadsDir = mkdtempSync(join(tmpdir(), 'a2a-auth-uploads-'));
const runsRoot = mkdtempSync(join(tmpdir(), 'a2a-auth-runs-'));
const mcpConfigPath = join(
  mkdtempSync(join(tmpdir(), 'a2a-auth-mcp-')),
  'm.json',
);
writeFileSync(mcpConfigPath, JSON.stringify({ mcpServers: {} }));

const unusedThrow = (label: string) => async (): Promise<never> => {
  throw new Error(`${label} should not be invoked by these tests`);
};

const a2aDeps: A2aServerDeps = {
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

let server: ReturnType<typeof Bun.serve>;
let base: string;

beforeAll(() => {
  server = Bun.serve({ port: 0, fetch: buildFetch(deps), idleTimeout: 0 });
  if (server.port === undefined) throw new Error('server did not bind a port');
  policy.port = server.port;
  base = `http://localhost:${server.port}`;
});
afterAll(() => {
  server.stop(true);
});
afterEach(() => {
  delete process.env.AGENT_A2A_ENABLED;
});

/** Fresh, unique replay headers so an authenticated request always passes the
 *  guard (a distinct nonce + a current timestamp in SECONDS). */
function freshReplay(): Record<string, string> {
  return {
    'x-a2a-timestamp': String(Math.floor(Date.now() / 1000)),
    'x-a2a-nonce': randomUUID(),
  };
}

const sendMsg = (id = 1): string =>
  JSON.stringify({
    jsonrpc: '2.0',
    id,
    method: 'message/send',
    params: {
      message: {
        role: 'user',
        parts: [{ kind: 'text', text: 'summarize this' }],
        messageId: `m-${id}`,
      },
      metadata: { skillId: 'ask' },
    },
  });

test('no/absent Bearer → 401 BEFORE the JSON-RPC body is parsed', async () => {
  process.env.AGENT_A2A_ENABLED = '1';
  // A body that is NOT valid JSON at all. If verify ran AFTER the parse we would
  // see a -32700 parse error (HTTP 200); a 401 here proves verify precedes parse
  // and the body was never read.
  const res = await fetch(`${base}${A2A_PATH}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{ this is : not json',
  });
  expect(res.status).toBe(401);
  const body = (await res.json()) as { error?: string };
  expect(body).not.toHaveProperty('jsonrpc'); // not a parse-error envelope
});

test('a bad Bearer → 401 (verify rejects, body never parsed)', async () => {
  process.env.AGENT_A2A_ENABLED = '1';
  const res = await fetch(`${base}${A2A_PATH}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer not-a-real-a2a-token',
      ...freshReplay(),
    },
    body: '{ still : not json',
  });
  expect(res.status).toBe(401);
  await res.text();
});

test('an over-long Bearer is rejected up front → 401', async () => {
  process.env.AGENT_A2A_ENABLED = '1';
  const res = await fetch(`${base}${A2A_PATH}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${'z'.repeat(9000)}`,
      ...freshReplay(),
    },
    body: sendMsg(),
  });
  expect(res.status).toBe(401);
  await res.text();
});

test('a valid A2A Bearer reaches dispatch (message/send → submitted task)', async () => {
  process.env.AGENT_A2A_ENABLED = '1';
  const res = await fetch(`${base}${A2A_PATH}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${validA2a}`,
      ...freshReplay(),
    },
    body: sendMsg(),
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    jsonrpc: string;
    result?: { status?: { state?: string }; kind?: string };
    error?: unknown;
  };
  expect(body.jsonrpc).toBe('2.0');
  expect(body.error).toBeUndefined();
  expect(body.result?.kind).toBe('task');
  expect(body.result?.status?.state).toBe('submitted');
});

test('a DEVICE session token → 401 (D5: not accepted on the A2A surface)', async () => {
  process.env.AGENT_A2A_ENABLED = '1';
  const res = await fetch(`${base}${A2A_PATH}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${deviceToken}`,
      ...freshReplay(),
    },
    body: sendMsg(),
  });
  expect(res.status).toBe(401);
  await res.text();
});

test('a replayed request (same nonce within the window) → 409', async () => {
  process.env.AGENT_A2A_ENABLED = '1';
  const replay = freshReplay();
  const first = await fetch(`${base}${A2A_PATH}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${validA2a}`,
      ...replay,
    },
    body: sendMsg(2),
  });
  expect(first.status).toBe(200);
  await first.text();

  // Same Bearer, SAME nonce + timestamp → replay → 409.
  const second = await fetch(`${base}${A2A_PATH}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${validA2a}`,
      ...replay,
    },
    body: sendMsg(3),
  });
  expect(second.status).toBe(409);
  await second.text();
});

test('a stale timestamp (outside the replay window) → 409', async () => {
  process.env.AGENT_A2A_ENABLED = '1';
  const res = await fetch(`${base}${A2A_PATH}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${validA2a}`,
      // ~1 hour in the past — far outside the default 300s window.
      'x-a2a-timestamp': String(Math.floor(Date.now() / 1000) - 3600),
      'x-a2a-nonce': randomUUID(),
    },
    body: sendMsg(4),
  });
  expect(res.status).toBe(409);
  await res.text();
});

test('a corrupt enrollment registry makes verify THROW → the route returns 401 (fail-closed, never 500)', async () => {
  process.env.AGENT_A2A_ENABLED = '1';
  // Stand up an isolated server whose enrollment loads a valid registry at
  // construction, then corrupt the on-disk registry so verify() re-reads it and
  // THROWS (fail-closed, Task 15). The gate must catch that as a rejection (401),
  // never let it bubble to an unhandled 500/crash.
  const dir = mkdtempSync(join(tmpdir(), 'a2a-auth-corrupt-'));
  const corruptRoot = createRootTokenStore({ path: join(dir, 'daemon-token') });
  const corruptRegistry = join(dir, 'a2a-tokens.json');
  const corruptEnroll = createA2aEnrollment({
    rootTokens: corruptRoot,
    registryPath: corruptRegistry,
  });
  // A token whose signature is VALID (so verify gets PAST the sig check and
  // reaches the registry read that will throw).
  const token = corruptEnroll.issue('will-corrupt').token;
  // Now corrupt the registry on disk — a present-but-unparseable file.
  writeFileSync(corruptRegistry, 'not json at all {{{');

  const corruptDeps: ServerDeps = {
    ...deps,
    policy: { port: 0, allowedOrigins: [] as string[] },
    a2a: { ...a2aDeps, enrollment: corruptEnroll },
  };
  const s = Bun.serve({
    port: 0,
    fetch: buildFetch(corruptDeps),
    idleTimeout: 0,
  });
  if (s.port === undefined) throw new Error('server did not bind a port');
  corruptDeps.policy.port = s.port;
  try {
    const res = await fetch(`http://localhost:${s.port}${A2A_PATH}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        'x-a2a-timestamp': String(Math.floor(Date.now() / 1000)),
        'x-a2a-nonce': randomUUID(),
      },
      body: sendMsg(5),
    });
    expect(res.status).toBe(401);
    expect(res.status).not.toBe(500);
    await res.text();
  } finally {
    s.stop(true);
  }
});
