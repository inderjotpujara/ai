import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
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
// None of these tests exercise POST /api/upload or an /api/chat body with
// uploadIds, so a plain (never-read) confined dir suffices.
const uploadsDir = mkdtempSync(join(tmpdir(), 'app-uploads-'));
// None of these tests exercise a Runs endpoint (Phase 3), so a plain
// (never-read) confined dir suffices here too.
const runsRoot = mkdtempSync(join(tmpdir(), 'app-runs-'));
// None of these tests exercise POST /api/chat — a fake that throws if ever
// invoked keeps the fixtures honest about what's actually under test here.
const unusedRunChatTurn: RunChatTurn = async () => {
  throw new Error('runChatTurn should not be invoked by these tests');
};
// None of these tests exercise a launch route either — throwing stubs keep
// the fixtures honest about what's actually under test here too.
const unusedRunCrewTurn: RunCrewTurn = async () => {
  throw new Error('runCrewTurn should not be invoked by these tests');
};
const unusedRunWorkflowTurn: RunWorkflowTurn = async () => {
  throw new Error('runWorkflowTurn should not be invoked by these tests');
};
// None of these tests exercise POST /api/builders/build either — same
// throwing-stub discipline as the other launch turns above.
const unusedRunBuilderTurn: RunBuilderTurn = async () => {
  throw new Error('runBuilderTurn should not be invoked by these tests');
};
// None of these tests exercise POST /api/mcp/test-mount either — same
// throwing-stub discipline as the other launch turns above.
const unusedMountOne: ServerDeps['mountOne'] = async () => {
  throw new Error('mountOne should not be invoked by these tests');
};
// None of these tests exercise a memory route either — a fake store whose
// methods throw keeps the fixtures honest about what's actually under test.
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
// None of these tests exercise a session route either — same
// throwing-stub discipline as unusedMemoryStore above.
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
// None of these tests exercise a queue/jobs route (they land in T18-20), so a
// never-touched stub keeps the fixture honest about what's under test here.
const unusedJobStore = {} as unknown as JobStore;
// None of these tests exercise POST /api/jobs/:id/cancel, so a fake that
// never registers a real controller (cancel() -> false) suffices here too.
const unusedPool = makeFakePool();
// A bare, never-populated mcp.json — these tests don't exercise /api/mcp.
const mcpConfigPath = join(mkdtempSync(join(tmpdir(), 'app-mcp-')), 'mcp.json');
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

beforeAll(() => {
  server = Bun.serve({ port: 0, fetch: buildFetch(deps), idleTimeout: 0 });
  const { port } = server;
  if (port === undefined)
    throw new Error('server did not bind an ephemeral port');
  policy.port = port; // reconcile the ephemeral port so Host allowlist matches
  base = `http://localhost:${port}`;
});
afterAll(() => server.stop(true));

test('GET / serves the index HTML under COOP/COEP', async () => {
  const res = await fetch(`${base}/`);
  expect(res.status).toBe(200);
  expect(res.headers.get('cross-origin-opener-policy')).toBe('same-origin');
  expect(res.headers.get('cross-origin-embedder-policy')).toBe('require-corp');
  expect(await res.text()).toContain('<!doctype html>');
});

test('/api/health requires the bearer token', async () => {
  const unauth = await fetch(`${base}/api/health`);
  expect(unauth.status).toBe(401);
  const ok = await fetch(`${base}/api/health`, {
    headers: { authorization: `Bearer ${TOKEN}` },
  });
  expect(ok.status).toBe(200);
  expect(await ok.json()).toEqual({ ok: true });
});

const validEvent = {
  kind: 'voice.transcribe.web',
  durationMs: 1200,
  wordCount: 8,
  modelTier: 'moonshine-tiny',
  realTimeFactor: 0.5,
  engine: 'transformers.js',
};

test('POST /api/telemetry authorizes via the BODY token (sendBeacon path, no Authorization header)', async () => {
  const ok = await fetch(`${base}/api/telemetry`, {
    method: 'POST',
    body: JSON.stringify({ token: TOKEN, event: validEvent }),
    headers: { 'content-type': 'application/json' },
  });
  expect(ok.status).toBe(204);
});

test('POST /api/telemetry with a wrong/missing body token is unauthorized (401)', async () => {
  const wrong = await fetch(`${base}/api/telemetry`, {
    method: 'POST',
    body: JSON.stringify({ token: 'b'.repeat(64), event: validEvent }),
    headers: { 'content-type': 'application/json' },
  });
  expect(wrong.status).toBe(401);
  const missing = await fetch(`${base}/api/telemetry`, {
    method: 'POST',
    body: JSON.stringify({ event: validEvent }),
    headers: { 'content-type': 'application/json' },
  });
  expect(missing.status).toBe(401);
});

test('the ?k= query token is no longer honored ANYWHERE (incl. /api/telemetry)', async () => {
  // The old sendBeacon `?k=` special-case is gone: a request carrying only a
  // query token — no header bearer, no body token — is 401 on every route,
  // /api/telemetry included.
  const health = await fetch(`${base}/api/health?k=${TOKEN}`);
  expect(health.status).toBe(401);
  const feedback = await fetch(`${base}/api/feedback?k=${TOKEN}`, {
    method: 'POST',
    body: '{}',
    headers: { 'content-type': 'application/json' },
  });
  expect(feedback.status).toBe(401);
  // Even the beacon route: a ?k= with no valid BODY token is unauthorized.
  const telemetry = await fetch(`${base}/api/telemetry?k=${TOKEN}`, {
    method: 'POST',
    body: JSON.stringify({ event: validEvent }),
    headers: { 'content-type': 'application/json' },
  });
  expect(telemetry.status).toBe(401);
});

test('the Host/Origin perimeter still fronts /api/telemetry (cross-origin rejected before the handler)', async () => {
  const res = await fetch(`${base}/api/telemetry`, {
    method: 'POST',
    body: JSON.stringify({ token: TOKEN, event: validEvent }),
    headers: {
      'content-type': 'application/json',
      origin: 'https://evil.example.com',
    },
  });
  expect(res.status).toBe(403);
});

test('a cross-origin request is rejected at the perimeter (403) before auth', async () => {
  const res = await fetch(`${base}/api/health`, {
    headers: {
      authorization: `Bearer ${TOKEN}`,
      origin: 'https://evil.example.com',
    },
  });
  expect(res.status).toBe(403);
});

test('an unknown /api route returns a JSON 404 (never throws)', async () => {
  const res = await fetch(`${base}/api/does-not-exist`, {
    headers: { authorization: `Bearer ${TOKEN}` },
  });
  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({ error: 'not found' });
});

test('an unexpected throw outside /api handling degrades to a JSON 500 (top-level catch-all)', async () => {
  // `indexHtml` is typed as a plain string, but the top-level try/catch must
  // also cover non-/api failures — a throwing getter forces exactly that path
  // (serveStatic reads deps.indexHtml for GET /) without touching /api at all.
  const throwingPolicy = { port: 0, allowedOrigins: [] as string[] };
  const throwingDeps: ServerDeps = {
    token: TOKEN,
    policy: throwingPolicy,
    recordIo: false,
    get indexHtml(): string {
      throw new Error('boom: index render failed');
    },
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
  const throwingServer = Bun.serve({
    port: 0,
    fetch: buildFetch(throwingDeps),
    idleTimeout: 0,
  });
  try {
    const { port } = throwingServer;
    if (port === undefined) throw new Error('server did not bind a port');
    throwingPolicy.port = port;
    const res = await fetch(`http://localhost:${port}/`);
    expect(res.status).toBe(500);
    expect(res.headers.get('cross-origin-opener-policy')).toBe('same-origin');
    expect(res.headers.get('cross-origin-embedder-policy')).toBe(
      'require-corp',
    );
    const body = (await res.json()) as { error: string };
    expect(typeof body.error).toBe('string');
    expect(body.error.length).toBeGreaterThan(0);
  } finally {
    throwingServer.stop(true);
  }
});

test('serveStatic confines staticDir: a normal file serves, a traversal/absolute-escape 404s', async () => {
  const staticDir = mkdtempSync(join(tmpdir(), 'app-static-'));
  writeFileSync(join(staticDir, 'hello.txt'), 'hi there');
  const confinedPolicy = { port: 0, allowedOrigins: [] as string[] };
  const confinedDeps: ServerDeps = {
    token: TOKEN,
    policy: confinedPolicy,
    staticDir,
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
  const confinedServer = Bun.serve({
    port: 0,
    fetch: buildFetch(confinedDeps),
    idleTimeout: 0,
  });
  try {
    const { port } = confinedServer;
    if (port === undefined) throw new Error('server did not bind a port');
    confinedPolicy.port = port;
    const confinedBase = `http://localhost:${port}`;

    const ok = await fetch(`${confinedBase}/hello.txt`);
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe('hi there');

    // The HTTP layer normalizes ".." out of the pathname before the server
    // ever sees it (both here and over the wire), so these requests arrive
    // as the plain, extensionless "/etc/passwd" — confineToDir still never
    // reads outside staticDir (no MediaPathError bubbles a real file), but
    // an extensionless miss now qualifies for the SPA fallback (200,
    // indexHtml) rather than a bare 404. The security invariant that
    // matters — the real /etc/passwd is never read or leaked — still
    // holds: assert the response is the safe indexHtml, not the escape
    // target's content.
    const traversal = await fetch(`${confinedBase}/../../../../etc/passwd`);
    expect(traversal.status).toBe(200);
    const traversalBody = await traversal.text();
    expect(traversalBody).toBe(confinedDeps.indexHtml);
    expect(traversalBody).not.toContain('root:');

    const encodedTraversal = await fetch(
      `${confinedBase}/%2e%2e/%2e%2e/etc/passwd`,
    );
    expect(encodedTraversal.status).toBe(200);
    expect(await encodedTraversal.text()).toBe(confinedDeps.indexHtml);
  } finally {
    confinedServer.stop(true);
  }
});

test('GET /runs (extensionless client route) falls back to the index HTML', async () => {
  const res = await fetch(`${base}/runs`);
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toContain('text/html');
  expect(res.headers.get('cross-origin-opener-policy')).toBe('same-origin');
  expect(await res.text()).toBe(deps.indexHtml);
});

test('GET /runs/run-abc (nested extensionless client route) falls back to the index HTML', async () => {
  const res = await fetch(`${base}/runs/run-abc`);
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toContain('text/html');
  expect(await res.text()).toBe(deps.indexHtml);
});

test('GET /assets/does-not-exist.js (extension, no matching file) still 404s — asset miss not masked', async () => {
  const res = await fetch(`${base}/assets/does-not-exist.js`);
  expect(res.status).toBe(404);
});

test('POST to an extensionless non-/api path does not get the HTML fallback (still 404)', async () => {
  const res = await fetch(`${base}/runs`, { method: 'POST' });
  expect(res.status).toBe(404);
});

test('serveStatic confineToDir blocks symlink escapes (real regression guard)', async () => {
  // Create a temp staticDir with a legit file.
  const staticDir = mkdtempSync(join(tmpdir(), 'app-static-secure-'));
  writeFileSync(join(staticDir, 'ok.txt'), 'allowed content');

  // Create a separate "outside" dir with a secret file (the escape target).
  const outsideDir = mkdtempSync(join(tmpdir(), 'app-outside-'));
  const secretMarker = 'SECRET_DATA_42';
  writeFileSync(join(outsideDir, 'secret.txt'), secretMarker);

  // Plant a symlink inside staticDir pointing to the outside secret.
  const symlinkPath = join(staticDir, 'leak.txt');
  const targetPath = join(outsideDir, 'secret.txt');
  symlinkSync(targetPath, symlinkPath);

  // Boot a server with confined staticDir.
  const symlinkPolicy = { port: 0, allowedOrigins: [] as string[] };
  const symlinkDeps: ServerDeps = {
    token: TOKEN,
    policy: symlinkPolicy,
    staticDir,
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
  const symlinkServer = Bun.serve({
    port: 0,
    fetch: buildFetch(symlinkDeps),
    idleTimeout: 0,
  });

  try {
    const { port } = symlinkServer;
    if (port === undefined) throw new Error('server did not bind a port');
    symlinkPolicy.port = port;
    const symlinkBase = `http://localhost:${port}`;

    // Normal file serves correctly through confineToDir.
    const okRes = await fetch(`${symlinkBase}/ok.txt`);
    expect(okRes.status).toBe(200);
    expect(await okRes.text()).toBe('allowed content');

    // Symlink escape is blocked by confineToDir → MediaPathError → 404.
    // The secret must NOT appear in the response.
    const leakRes = await fetch(`${symlinkBase}/leak.txt`);
    expect(leakRes.status).toBe(404);
    const leakBody = await leakRes.text();
    expect(leakBody).not.toContain(secretMarker);
  } finally {
    symlinkServer.stop(true);
  }
});
