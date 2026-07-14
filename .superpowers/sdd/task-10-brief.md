### Task 10: Server — thin Bun.serve BFF (pipeline + `/api/health` + static/COOP-COEP)

**Files:**
- Create: `src/server/app.ts`
- Test: `tests/server/app.test.ts`

**Interfaces:**
- Consumes: `enforcePerimeter`, `type OriginPolicy` from `./security/origin.ts`; `createTokenGuard` from `./security/token.ts`; `withServerRequestSpan` from `../telemetry/spans.ts`; `explain` from `../errors/boundary.ts`.
- Produces: `type ServerDeps = { token: string; policy: OriginPolicy; staticDir?: string; recordIo: boolean; indexHtml: string }`; `buildFetch(deps: ServerDeps): (req: Request) => Promise<Response>`.

- [ ] **Step 1: Write the failing BFF integration test (booted Bun.serve)**

```ts
// tests/server/app.test.ts
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { type ServerDeps, buildFetch } from '../../src/server/app.ts';

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
  policy.port = server.port; // reconcile the ephemeral port so Host allowlist matches
  base = `http://localhost:${server.port}`;
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
  const ok = await fetch(`${base}/api/health`, { headers: { authorization: `Bearer ${TOKEN}` } });
  expect(ok.status).toBe(200);
  expect(await ok.json()).toEqual({ ok: true });
});

test('a cross-origin request is rejected at the perimeter (403) before auth', async () => {
  const res = await fetch(`${base}/api/health`, {
    headers: { authorization: `Bearer ${TOKEN}`, origin: 'https://evil.example.com' },
  });
  expect(res.status).toBe(403);
});

test('an unknown /api route returns a JSON 404 (never throws)', async () => {
  const res = await fetch(`${base}/api/does-not-exist`, { headers: { authorization: `Bearer ${TOKEN}` } });
  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({ error: 'not found' });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/server/app.test.ts`
Expected: FAIL — cannot resolve `../../src/server/app.ts`.

- [ ] **Step 3: Write the BFF**

```ts
// src/server/app.ts
import { join } from 'node:path';
import { explain } from '../errors/boundary.ts';
import { withServerRequestSpan } from '../telemetry/spans.ts';
import { type OriginPolicy, enforcePerimeter } from './security/origin.ts';
import { createTokenGuard } from './security/token.ts';

/**
 * The thin BFF's dependencies. It owns NO business logic: it enforces the
 * perimeter, checks the token, routes, and maps typed errors to JSON. Engine
 * wiring (chat/runs/crews/…) attaches in later phases.
 */
export type ServerDeps = {
  token: string;
  policy: OriginPolicy;
  staticDir?: string;
  recordIo: boolean;
  indexHtml: string;
};

/** COOP/COEP so the frontend can later use sherpa WASM SharedArrayBuffer. */
const ISOLATION_HEADERS: Record<string, string> = {
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-embedder-policy': 'require-corp',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...ISOLATION_HEADERS },
  });
}

export function buildFetch(deps: ServerDeps): (req: Request) => Promise<Response> {
  const guard = createTokenGuard(deps.token);
  return async (req) => {
    const blocked = enforcePerimeter(req, deps.policy);
    if (blocked) return blocked;

    const url = new URL(req.url);
    if (url.pathname.startsWith('/api')) {
      if (!guard.verify(req)) return json({ error: 'unauthorized' }, 401);
      return handleApi(req, url);
    }
    return serveStatic(url, deps);
  };
}

async function handleApi(req: Request, url: URL): Promise<Response> {
  return withServerRequestSpan({ route: url.pathname, method: req.method }, async (rec) => {
    try {
      if (url.pathname === '/api/health') {
        rec.status(200);
        return json({ ok: true });
      }
      rec.status(404);
      return json({ error: 'not found' }, 404);
    } catch (err) {
      // Never crash the handler: map the typed error to an actionable JSON body.
      rec.status(500);
      return json({ error: explain(err).title }, 500);
    }
  });
}

async function serveStatic(url: URL, deps: ServerDeps): Promise<Response> {
  if (url.pathname === '/' || url.pathname === '/index.html') {
    return new Response(deps.indexHtml, {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        ...ISOLATION_HEADERS,
      },
    });
  }
  // Reject traversal before any filesystem touch.
  if (deps.staticDir && !url.pathname.includes('..')) {
    const file = Bun.file(join(deps.staticDir, url.pathname));
    if (await file.exists()) {
      return new Response(file, { headers: { ...ISOLATION_HEADERS } });
    }
  }
  return new Response('not found', { status: 404, headers: { ...ISOLATION_HEADERS } });
}
```

- [ ] **Step 4: Run BFF test + typecheck to verify pass**

Run: `bun test tests/server/app.test.ts && bun run typecheck`
Expected: PASS (4 tests) and no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/server/app.ts tests/server/app.test.ts
git commit -m "feat(server): add thin Bun.serve BFF pipeline, /api/health, COOP/COEP static serving"
```

---

