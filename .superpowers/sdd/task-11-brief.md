### Task 11: Wire the three GET routes into `handleApi`

**Files:**
- Modify: `src/server/app.ts` (`handleApi`)
- Test: `tests/server/runs-routes.test.ts` (through `buildFetch`, perimeter + token still enforced)

**Interfaces:**
- Consumes: `handleRunDetail` (Task 8), `handleRunList` (Task 9), `handleRunStream` (Task 10).
- Produces: three GET matches in `handleApi`, ordered **stream before bare-id** (so `:id/stream` is not swallowed by `:id`), and list before both. The existing POST `/api/runs/:id/respond` match stays. `handleRunStream` passes `{ lastEventId: req.headers.get('Last-Event-ID') ?? undefined, signal: req.signal }`.

- [ ] **Step 1: Write the failing test** — `tests/server/runs-routes.test.ts` (mirror `app.test.ts`'s `buildFetch` boot with a `runsRoot` pointed at a tmp dir holding one run):

```ts
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildFetch, type ServerDeps } from '../../src/server/app.ts';
import type { RunChatTurn } from '../../src/server/chat/run-turn.ts';
import { createConsentRegistry } from '../../src/server/consent/registry.ts';

const TOKEN = 'a'.repeat(64);
const policy = { port: 0, allowedOrigins: [] as string[] };
const runsRoot = mkdtempSync(join(tmpdir(), 'routes-runs-'));
mkdirSync(join(runsRoot, 'run-1'), { recursive: true });
writeFileSync(
  join(runsRoot, 'run-1', 'spans.jsonl'),
  `${JSON.stringify({ name: 'agent.run', kind: 0, traceId: 't', spanId: 'a', parentSpanId: null, startUnixNano: 0, endUnixNano: 1_000_000, durationMs: 1, status: { code: 0 }, attributes: { 'agent.outcome': 'answer' }, events: [] })}\n`,
);
const noRun: RunChatTurn = async () => { throw new Error('unused'); };
const deps: ServerDeps = {
  token: TOKEN, policy, recordIo: false, indexHtml: '<!doctype html><title>t</title>',
  runChatTurn: noRun, consent: createConsentRegistry(), uploadsDir: runsRoot, runsRoot,
};

let server: ReturnType<typeof Bun.serve>;
let base: string;
beforeAll(() => {
  server = Bun.serve({ port: 0, fetch: buildFetch(deps), idleTimeout: 0 });
  const { port } = server;
  if (port === undefined) throw new Error('no port');
  policy.port = port;
  base = `http://localhost:${port}`;
});
afterAll(() => server.stop(true));

const auth = { authorization: `Bearer ${TOKEN}` };

test('GET /api/runs requires the token', async () => {
  expect((await fetch(`${base}/api/runs`)).status).toBe(401);
});

test('GET /api/runs lists the run', async () => {
  const res = await fetch(`${base}/api/runs`, { headers: auth });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { items: { id: string }[]; total: number };
  expect(body.items.map((i) => i.id)).toContain('run-1');
});

test('GET /api/runs/:id returns the RunDTO', async () => {
  const res = await fetch(`${base}/api/runs/run-1`, { headers: auth });
  expect(res.status).toBe(200);
  expect(((await res.json()) as { id: string }).id).toBe('run-1');
});

test('GET /api/runs/:id/stream opens an event-stream (not the detail JSON)', async () => {
  const res = await fetch(`${base}/api/runs/run-1/stream`, { headers: auth });
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toContain('text/event-stream');
  await res.body?.cancel();
});

test('GET /api/runs/missing → 404', async () => {
  expect((await fetch(`${base}/api/runs/missing`, { headers: auth })).status).toBe(404);
});
```

- [ ] **Step 2: Run to fail** — `bun test --path-ignore-patterns 'web/**' tests/server/runs-routes.test.ts` → FAIL (routes not wired).

- [ ] **Step 3: Minimal impl** — in `src/server/app.ts` `handleApi`, add imports and the matches (place BEFORE the existing `respondMatch` block or after `/api/feedback` — but the stream/detail/list GET matches must be ordered stream→detail, and none collide with the POST respond match):

```ts
import { handleRunDetail } from './runs/detail.ts';
import { handleRunList } from './runs/list.ts';
import { handleRunStream } from './runs/stream.ts';

// ... inside handleApi, after the /api/health block and before the 404:
if (req.method === 'GET' && url.pathname === '/api/runs') {
  rec.status(200);
  return handleRunList(url.searchParams, deps);
}
const streamMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/stream$/);
if (req.method === 'GET' && streamMatch?.[1]) {
  rec.status(200);
  return handleRunStream(streamMatch[1], deps, {
    lastEventId: req.headers.get('Last-Event-ID') ?? undefined,
    signal: req.signal,
  });
}
const detailMatch = url.pathname.match(/^\/api\/runs\/([^/]+)$/);
if (req.method === 'GET' && detailMatch?.[1]) {
  const res = await handleRunDetail(detailMatch[1], deps);
  rec.status(res.status);
  return res;
}
```

(Note: `handleRunDetail` may 404, so set `rec.status` from the actual response, not a hardcoded 200.)

- [ ] **Step 4: Run to pass** — `bun test --path-ignore-patterns 'web/**' tests/server/runs-routes.test.ts tests/server/app.test.ts` → PASS (existing perimeter/token/404 tests still green).

- [ ] **Step 5: Gate + commit**

```bash
bun run typecheck && bun run lint:file -- "src/server/app.ts" "tests/server/runs-routes.test.ts"
git add src/server/app.ts tests/server/runs-routes.test.ts
git commit -m "feat(server): wire GET /api/runs, /api/runs/:id, /api/runs/:id/stream into handleApi"
```

---

## Layer ④ — Web feature

