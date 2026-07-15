### Task 6: `summarizeRunListItem` + mtime-keyed summary cache

**Files:**
- Modify: `src/run/run-dto.ts`
- Test: `tests/run/run-summary.test.ts`

**Interfaces:**
- Consumes: `readSpans`, `ATTR`, `readDegrades` (Task 5), `RunListItemDtoSchema`/`RunListItemDTO`, `RunLifecycle`, `RunOrigin` from `../contracts/index.ts`; `node:fs/promises` `stat`.
- Produces: `summarizeRunListItem(runsRoot: string, id: string): Promise<RunListItemDTO | undefined>` — the list-cheap projection (spanCount/models/lifecycle/tokens/outcome/degraded), **no full flatten, no artifacts, no degrades-file read** (degraded is derived from span events — cheaper than reading the file). Fronted by a module-level **mtime cache keyed on `spans.jsonl`'s `mtimeMs`** — because appending to `spans.jsonl` bumps the FILE mtime (a directory's mtime does NOT change on content append), so keying on the file is what actually invalidates an in-flight run. A hit returns the memoized item; a miss (or changed mtime) recomputes.

- [ ] **Step 1: Write the failing test** — `tests/run/run-summary.test.ts`:

```ts
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunLifecycle } from '../../src/contracts/enums.ts';
import {
  __summaryCacheSize,
  summarizeRunListItem,
} from '../../src/run/run-dto.ts';
import type { SpanRecord } from '../../src/telemetry/jsonl-exporter.ts';

function span(p: Partial<SpanRecord> & { name: string; spanId: string }): SpanRecord {
  return { kind: 0, traceId: 't', parentSpanId: null, startUnixNano: 0, endUnixNano: 1_000_000, durationMs: 1, status: { code: 0 }, attributes: {}, events: [], ...p };
}

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'rs-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function write(id: string, spans: SpanRecord[]) {
  const dir = join(root, id);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'spans.jsonl'), `${spans.map((s) => JSON.stringify(s)).join('\n')}\n`);
  return dir;
}

test('summarizes a run without spans/artifacts arrays', async () => {
  await write('r1', [
    span({ name: 'agent.run', spanId: 'a', durationMs: 5, attributes: { 'agent.outcome': 'answer', 'gen_ai.request.model': 'm' } }),
  ]);
  const item = await summarizeRunListItem(root, 'r1');
  expect(item?.outcome).toBe('answer');
  expect(item?.lifecycle).toBe(RunLifecycle.Done);
  expect(item?.models).toEqual(['m']);
  expect(item?.spanCount).toBe(1);
});

test('memoizes on unchanged spans.jsonl mtime, recomputes when it changes', async () => {
  await write('r2', [span({ name: 'agent.run', spanId: 'a' })]);
  await summarizeRunListItem(root, 'r2');
  const sizeAfterFirst = __summaryCacheSize();
  await summarizeRunListItem(root, 'r2'); // cache hit — no new entry
  expect(__summaryCacheSize()).toBe(sizeAfterFirst);
  // append a span → file mtime changes → recompute
  await new Promise((r) => setTimeout(r, 10));
  await writeFile(join(root, 'r2', 'spans.jsonl'), `${JSON.stringify(span({ name: 'agent.run', spanId: 'a' }))}\n${JSON.stringify(span({ name: 'x', spanId: 'b' }))}\n`);
  const item = await summarizeRunListItem(root, 'r2');
  expect(item?.spanCount).toBe(2);
});

test('undefined for a run with no spans', async () => {
  expect(await summarizeRunListItem(root, 'nope')).toBeUndefined();
});
```

- [ ] **Step 2: Run to fail** — `bun test --path-ignore-patterns 'web/**' tests/run/run-summary.test.ts` → FAIL (`summarizeRunListItem`/`__summaryCacheSize` not exported).

- [ ] **Step 3: Minimal impl** — append to `src/run/run-dto.ts`:

```ts
import { stat } from 'node:fs/promises';
import {
  type RunListItemDTO,
  RunListItemDtoSchema,
} from '../contracts/index.ts';

// mtime-keyed summary cache. The rich list would otherwise be O(runs ×
// spans/run) disk reads per keystroke-driven request; a real persisted index
// is Phase 6 — this is the stateless-friendly interim. Keyed on spans.jsonl's
// mtimeMs so an in-flight run (still being appended) always recomputes.
const summaryCache = new Map<string, { mtimeMs: number; item: RunListItemDTO }>();

/** Test-only: current cache entry count (asserts memoization vs recompute). */
export function __summaryCacheSize(): number {
  return summaryCache.size;
}

export async function summarizeRunListItem(
  runsRoot: string,
  id: string,
): Promise<RunListItemDTO | undefined> {
  const runDir = join(runsRoot, id);
  let mtimeMs: number;
  try {
    mtimeMs = (await stat(join(runDir, 'spans.jsonl'))).mtimeMs;
  } catch {
    return undefined; // no spans.jsonl → not a completed/started run
  }
  const cached = summaryCache.get(runDir);
  if (cached && cached.mtimeMs === mtimeMs) return cached.item;

  const { spans } = await readSpans(runDir);
  if (spans.length === 0) return undefined;
  const runRoot = spans.find((s) => s.name === 'agent.run');
  const models = new Set<string>();
  let tokIn: number | undefined;
  let tokOut: number | undefined;
  let degraded = false;
  for (const s of spans) {
    const m = str(s.attributes[ATTR.MODEL_ID]);
    if (m) models.add(m);
    const i = num(s.attributes[ATTR.USAGE_INPUT_TOKENS]);
    const o = num(s.attributes[ATTR.USAGE_OUTPUT_TOKENS]);
    if (i !== undefined) tokIn = (tokIn ?? 0) + i;
    if (o !== undefined) tokOut = (tokOut ?? 0) + o;
    if (s.events.some((e) => e.name === 'reliability.degrade')) degraded = true;
  }
  const outcome = str(runRoot?.attributes[ATTR.OUTCOME]) ?? 'unknown';
  const lifecycle = !runRoot
    ? RunLifecycle.Running
    : runRoot.status.code === OTEL_STATUS_ERROR || outcome === 'resource'
      ? RunLifecycle.Failed
      : RunLifecycle.Done;
  const item = RunListItemDtoSchema.parse({
    id,
    startMs: Math.round((runRoot ?? spans[0]).startUnixNano / NANOS_PER_MS),
    durationMs: runRoot?.durationMs ?? 0,
    outcome,
    lifecycle,
    origin: RunOrigin.Manual,
    models: [...models],
    degraded,
    spanCount: spans.length,
    tokens:
      tokIn === undefined && tokOut === undefined
        ? undefined
        : { input: tokIn, output: tokOut },
  });
  summaryCache.set(runDir, { mtimeMs, item });
  return item;
}
```

- [ ] **Step 4: Run to pass** — `bun test --path-ignore-patterns 'web/**' tests/run/run-summary.test.ts tests/run/run-dto.test.ts` → PASS.

- [ ] **Step 5: Gate + commit**

```bash
bun run typecheck && bun run lint:file -- "src/run/run-dto.ts" "tests/run/run-summary.test.ts"
git add src/run/run-dto.ts tests/run/run-summary.test.ts
git commit -m "feat(run): summarizeRunListItem + mtime-keyed summary cache (Phase-6 index is the real fix)"
```

---

## Layer ③ — Server endpoints

