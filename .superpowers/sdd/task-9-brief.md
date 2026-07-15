### Task 9: `handleRunList` — `GET /api/runs` filtered/sorted/paginated list

**Files:**
- Create: `src/server/runs/list.ts`
- Test: `tests/server/runs-list.test.ts`

**Interfaces:**
- Consumes: `RunListQuerySchema`, `RunListResponseSchema` from `../../contracts/index.ts`; `summarizeRunListItem` (Task 6); `readdir` from `node:fs/promises`; `RunsDeps` from `./detail.ts`; `ISOLATION_HEADERS`.
- Produces: `handleRunList(params: URLSearchParams, deps: RunsDeps): Promise<Response>` — build a raw object from `params`, `RunListQuerySchema.parse` it, `readdir(runsRoot)` for directories, `summarizeRunListItem` each (cache-fronted), filter (`search` case-insensitive substring over `id` + `models.join(' ')` + `outcome`; `outcome` exact facet; `degraded` exact facet), **sort desc by `startMs`**, then paginate via an opaque cursor. `total` = filtered count; `nextCursor` set when more remain. 200 JSON `RunListResponse`.
- Cursor helpers: `encodeCursor(item) = base64url(`${item.startMs}:${item.id}`)`; `decodeCursor(s)` → `{ startMs, id }`. Pagination: after the desc sort, if a cursor is given, drop items up to and including the one whose `id` matches the cursor's `id`; then take `limit`.

- [ ] **Step 1: Write the failing test** — `tests/server/runs-list.test.ts`:

```ts
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RunListResponse } from '../../src/contracts/requests.ts';
import { handleRunList } from '../../src/server/runs/list.ts';
import type { SpanRecord } from '../../src/telemetry/jsonl-exporter.ts';

function span(p: Partial<SpanRecord> & { name: string; spanId: string }): SpanRecord {
  return { kind: 0, traceId: 't', parentSpanId: null, startUnixNano: 0, endUnixNano: 1_000_000, durationMs: 1, status: { code: 0 }, attributes: {}, events: [], ...p };
}

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'list-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function writeRun(id: string, startNano: number, attrs: Record<string, unknown>, extraSpans: SpanRecord[] = []) {
  const dir = join(root, id);
  await mkdir(dir, { recursive: true });
  const spans = [span({ name: 'agent.run', spanId: `${id}-a`, startUnixNano: startNano, attributes: attrs }), ...extraSpans];
  await writeFile(join(dir, 'spans.jsonl'), `${spans.map((s) => JSON.stringify(s)).join('\n')}\n`);
}

async function list(qs: string): Promise<RunListResponse> {
  const res = await handleRunList(new URLSearchParams(qs), { runsRoot: root });
  expect(res.status).toBe(200);
  return (await res.json()) as RunListResponse;
}

test('sorts newest-first by startMs and reports total', async () => {
  await writeRun('old', 1_000_000_000, { 'agent.outcome': 'answer', 'gen_ai.request.model': 'qwen' });
  await writeRun('new', 5_000_000_000, { 'agent.outcome': 'answer', 'gen_ai.request.model': 'llama' });
  const page = await list('');
  expect(page.total).toBe(2);
  expect(page.items.map((i) => i.id)).toEqual(['new', 'old']);
});

test('search filters over id/models/outcome (case-insensitive)', async () => {
  await writeRun('run-a', 2_000_000_000, { 'agent.outcome': 'answer', 'gen_ai.request.model': 'qwen3.5:9b' });
  await writeRun('run-b', 1_000_000_000, { 'agent.outcome': 'gap', 'gen_ai.request.model': 'llama' });
  expect((await list('search=QWEN')).items.map((i) => i.id)).toEqual(['run-a']);
  expect((await list('search=gap')).items.map((i) => i.id)).toEqual(['run-b']);
});

test('outcome + degraded facets filter', async () => {
  await writeRun('r-ok', 3_000_000_000, { 'agent.outcome': 'answer' });
  await writeRun('r-gap', 2_000_000_000, { 'agent.outcome': 'gap' });
  await writeRun('r-deg', 1_000_000_000, { 'agent.outcome': 'answer' }, [
    span({ name: 'agent.delegation', spanId: 'd', events: [{ name: 'reliability.degrade', timeUnixNano: 0 }] }),
  ]);
  expect((await list('outcome=gap')).items.map((i) => i.id)).toEqual(['r-gap']);
  expect((await list('degraded=true')).items.map((i) => i.id)).toEqual(['r-deg']);
});

test('paginates via limit + opaque cursor', async () => {
  await writeRun('a', 3_000_000_000, { 'agent.outcome': 'answer' });
  await writeRun('b', 2_000_000_000, { 'agent.outcome': 'answer' });
  await writeRun('c', 1_000_000_000, { 'agent.outcome': 'answer' });
  const p1 = await list('limit=2');
  expect(p1.items.map((i) => i.id)).toEqual(['a', 'b']);
  expect(p1.nextCursor).toBeDefined();
  const p2 = await list(`limit=2&cursor=${encodeURIComponent(p1.nextCursor as string)}`);
  expect(p2.items.map((i) => i.id)).toEqual(['c']);
  expect(p2.nextCursor).toBeUndefined();
});
```

- [ ] **Step 2: Run to fail** — `bun test --path-ignore-patterns 'web/**' tests/server/runs-list.test.ts` → FAIL (module missing).

- [ ] **Step 3: Minimal impl** — `src/server/runs/list.ts`:

```ts
import { readdir } from 'node:fs/promises';
import type { RunListItemDTO } from '../../contracts/index.ts';
import {
  RunListQuerySchema,
  RunListResponseSchema,
} from '../../contracts/index.ts';
import { summarizeRunListItem } from '../../run/run-dto.ts';
import { ISOLATION_HEADERS } from '../isolation-headers.ts';
import type { RunsDeps } from './detail.ts';

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...ISOLATION_HEADERS,
    },
  });
}

function encodeCursor(item: RunListItemDTO): string {
  return Buffer.from(`${item.startMs}:${item.id}`).toString('base64url');
}
function decodeCursorId(cursor: string): string | undefined {
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    const idx = decoded.indexOf(':');
    return idx === -1 ? undefined : decoded.slice(idx + 1);
  } catch {
    return undefined;
  }
}

function matchesSearch(item: RunListItemDTO, search: string): boolean {
  const hay = `${item.id} ${item.models.join(' ')} ${item.outcome}`.toLowerCase();
  return hay.includes(search.toLowerCase());
}

export async function handleRunList(
  params: URLSearchParams,
  deps: RunsDeps,
): Promise<Response> {
  const query = RunListQuerySchema.parse({
    search: params.get('search') ?? undefined,
    outcome: params.get('outcome') ?? undefined,
    degraded: params.get('degraded') ?? undefined,
    limit: params.get('limit') ?? undefined,
    cursor: params.get('cursor') ?? undefined,
  });

  let ids: string[];
  try {
    const entries = await readdir(deps.runsRoot, { withFileTypes: true });
    ids = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return json(RunListResponseSchema.parse({ items: [], total: 0 }), 200);
  }

  const summaries: RunListItemDTO[] = [];
  for (const id of ids) {
    const item = await summarizeRunListItem(deps.runsRoot, id);
    if (item) summaries.push(item);
  }

  const filtered = summaries
    .filter((s) => (query.search ? matchesSearch(s, query.search) : true))
    .filter((s) => (query.outcome ? s.outcome === query.outcome : true))
    .filter((s) =>
      query.degraded === undefined ? true : s.degraded === query.degraded,
    )
    .sort((a, b) => b.startMs - a.startMs);

  let start = 0;
  if (query.cursor) {
    const cursorId = decodeCursorId(query.cursor);
    const idx = filtered.findIndex((s) => s.id === cursorId);
    start = idx === -1 ? 0 : idx + 1;
  }
  const page = filtered.slice(start, start + query.limit);
  const hasMore = start + query.limit < filtered.length;
  const last = page[page.length - 1];

  return json(
    RunListResponseSchema.parse({
      items: page,
      total: filtered.length,
      nextCursor: hasMore && last ? encodeCursor(last) : undefined,
    }),
    200,
  );
}
```

- [ ] **Step 4: Run to pass** — `bun test --path-ignore-patterns 'web/**' tests/server/runs-list.test.ts` → PASS.

- [ ] **Step 5: Gate + commit**

```bash
bun run typecheck && bun run lint:file -- "src/server/runs/list.ts" "tests/server/runs-list.test.ts"
git add src/server/runs/list.ts tests/server/runs-list.test.ts
git commit -m "feat(server): handleRunList — filtered/sorted/paginated GET /api/runs"
```

---

