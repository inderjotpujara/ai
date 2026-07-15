### Task 8: `handleRunDetail` — `GET /api/runs/:id` → RunDTO / 404

**Files:**
- Create: `src/server/runs/detail.ts`
- Test: `tests/server/runs-detail.test.ts`

**Interfaces:**
- Consumes: `mapRunToDto` (Task 5); `confineToDir`, `MediaPathError` from `../security/media-path.ts`; the `json` helper (re-declare the small local `json` as in `chat/handler.ts`, or import from `../app.ts` — prefer a local copy to avoid a cycle, mirroring `chat/handler.ts`).
- Produces: `type RunsDeps = { runsRoot: string }` and `handleRunDetail(id: string, deps: RunsDeps): Promise<Response>` — `confineToDir(id, runsRoot)` guards traversal (`MediaPathError` → 404, no leak); `mapRunToDto` `undefined` → 404; else 200 JSON `RunDTO` under `ISOLATION_HEADERS`.

- [ ] **Step 1: Write the failing test** — `tests/server/runs-detail.test.ts`:

```ts
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleRunDetail } from '../../src/server/runs/detail.ts';
import type { SpanRecord } from '../../src/telemetry/jsonl-exporter.ts';

function span(p: Partial<SpanRecord> & { name: string; spanId: string }): SpanRecord {
  return { kind: 0, traceId: 't', parentSpanId: null, startUnixNano: 0, endUnixNano: 1_000_000, durationMs: 1, status: { code: 0 }, attributes: {}, events: [], ...p };
}

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'det-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

test('200 with a RunDTO for an existing run', async () => {
  const dir = join(root, 'run-1');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'spans.jsonl'), `${JSON.stringify(span({ name: 'agent.run', spanId: 'a', attributes: { 'agent.outcome': 'answer' } }))}\n`);
  const res = await handleRunDetail('run-1', { runsRoot: root });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { id: string; outcome: string };
  expect(body.id).toBe('run-1');
  expect(body.outcome).toBe('answer');
  expect(res.headers.get('cross-origin-opener-policy')).toBe('same-origin');
});

test('404 for a missing run', async () => {
  const res = await handleRunDetail('nope', { runsRoot: root });
  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({ error: 'not found' });
});

test('path traversal on :id → 404 (no leak, MediaPathError)', async () => {
  const res = await handleRunDetail('../../../../etc', { runsRoot: root });
  expect(res.status).toBe(404);
});
```

- [ ] **Step 2: Run to fail** — `bun test --path-ignore-patterns 'web/**' tests/server/runs-detail.test.ts` → FAIL (module missing).

- [ ] **Step 3: Minimal impl** — `src/server/runs/detail.ts`:

```ts
import { mapRunToDto } from '../../run/run-dto.ts';
import { ISOLATION_HEADERS } from '../isolation-headers.ts';
import { confineToDir, MediaPathError } from '../security/media-path.ts';

export type RunsDeps = { runsRoot: string };

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...ISOLATION_HEADERS,
    },
  });
}

/** `GET /api/runs/:id` — full RunDTO, or 404 (missing OR path-escaping id). */
export async function handleRunDetail(
  id: string,
  deps: RunsDeps,
): Promise<Response> {
  try {
    confineToDir(id, deps.runsRoot); // realpath-confine; throws on ../ / symlink / missing
  } catch (err) {
    if (err instanceof MediaPathError) return json({ error: 'not found' }, 404);
    throw err;
  }
  const dto = await mapRunToDto(deps.runsRoot, id);
  if (!dto) return json({ error: 'not found' }, 404);
  return json(dto, 200);
}
```

- [ ] **Step 4: Run to pass** — `bun test --path-ignore-patterns 'web/**' tests/server/runs-detail.test.ts` → PASS.

- [ ] **Step 5: Gate + commit**

```bash
bun run typecheck && bun run lint:file -- "src/server/runs/detail.ts" "tests/server/runs-detail.test.ts"
git add src/server/runs/detail.ts tests/server/runs-detail.test.ts
git commit -m "feat(server): handleRunDetail — GET /api/runs/:id → RunDTO / 404 (confineToDir guarded)"
```

---

