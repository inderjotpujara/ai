import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildFetch, type ServerDeps } from '../../src/server/app.ts';

const TOKEN = 'a'.repeat(64);
const policy = { port: 0, allowedOrigins: [] as string[] };
const deps: ServerDeps = {
  token: TOKEN,
  policy,
  recordIo: false,
  indexHtml: '<!doctype html><title>t</title>',
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

    const traversal = await fetch(`${confinedBase}/../../../../etc/passwd`);
    expect(traversal.status).toBe(404);
    expect(await traversal.text()).not.toContain('root:');

    const encodedTraversal = await fetch(
      `${confinedBase}/%2e%2e/%2e%2e/etc/passwd`,
    );
    expect(encodedTraversal.status).toBe(404);
  } finally {
    confinedServer.stop(true);
  }
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
