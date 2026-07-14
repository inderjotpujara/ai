import { afterAll, beforeAll, expect, test } from 'bun:test';
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
