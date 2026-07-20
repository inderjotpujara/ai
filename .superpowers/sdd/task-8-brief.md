## Task 8: `GET /api/queue/stats` route + `toQueueStatsDto` + app.ts wiring + telemetry

**Files:**
- Create: `src/server/queue/stats.ts` (the handler)
- Modify: `src/server/app.ts` (route + `ServerDeps.queueConcurrency`)
- Modify: `src/daemon/spans.ts` (add `recordQueueStatsRead`) — or a new `src/server/queue/spans.ts`; keep it in `daemon/spans.ts` beside the other queue spans
- Test: `tests/server/queue/stats.test.ts` (new)

**Interfaces:**
- Consumes: `JobStore.stats()` (T7), `WorkerPool.activeCount()` (`src/queue/pool.ts:27`), `QueueStatsDtoSchema` (T3), `ServerDeps` (`src/server/app.ts:66`).
- Produces: `handleQueueStats(deps: { jobStore; pool; queueConcurrency }): Response` → `QueueStatsDTO` (`counts`+`total` from `stats()`, `activeCount` from `pool.activeCount()`, `concurrency` from `deps.queueConcurrency`). `ServerDeps.queueConcurrency: number`. Route `GET /api/queue/stats`.

- [ ] **Step 1: Write the failing test** — `tests/server/queue/stats.test.ts`:
```typescript
import { test, expect } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJobStore } from '../../../src/queue/store.ts';
import { JobKind } from '../../../src/queue/types.ts';
import { handleQueueStats } from '../../../src/server/queue/stats.ts';

test('GET /api/queue/stats reports counts + activeCount + concurrency', async () => {
  const jobStore = createJobStore({ path: mkdtempSync(join(tmpdir(), 'jobs-')) }, {});
  jobStore.enqueue({ kind: JobKind.Crew, payload: 1 });
  const pool = { activeCount: () => 0 } as { activeCount(): number };
  const res = handleQueueStats({ jobStore, pool, queueConcurrency: 4 });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.total).toBe(1);
  expect(body.counts.queued).toBe(1);
  expect(body.concurrency).toBe(4);
  expect(body.activeCount).toBe(0);
  jobStore.close();
});
```

- [ ] **Step 2: Run — verify it fails** → FAIL (module missing).

- [ ] **Step 3: Implement `src/server/queue/stats.ts`**:
```typescript
import { QueueStatsDtoSchema } from '../../contracts/index.ts';
import type { WorkerPool } from '../../queue/pool.ts';
import type { JobStore } from '../../queue/store.ts';
import { recordQueueStatsRead } from '../../daemon/spans.ts';
import { ISOLATION_HEADERS } from '../isolation-headers.ts';

export type QueueStatsDeps = {
  jobStore: JobStore;
  pool: Pick<WorkerPool, 'activeCount'>;
  queueConcurrency: number;
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...ISOLATION_HEADERS },
  });
}

/**
 * `GET /api/queue/stats` — queue health for the Overview tab. `counts`+`total`
 * come from the store's SINGLE race-free snapshot (§7.2); `activeCount` is the
 * pool's in-flight controller count, reported as a SEPARATE field (never
 * reconciled by arithmetic with the DB `running` count — they may transiently
 * differ, and the panel labels them "running rows" vs "active workers").
 */
export function handleQueueStats(deps: QueueStatsDeps): Response {
  const { counts, total } = deps.jobStore.stats();
  recordQueueStatsRead();
  return json(
    QueueStatsDtoSchema.parse({
      counts,
      total,
      activeCount: deps.pool.activeCount(),
      concurrency: deps.queueConcurrency,
    }),
    200,
  );
}
```

- [ ] **Step 4: Add the span helper** — in `src/daemon/spans.ts`, add (following the `recordJobEnqueue` no-op pattern):
```typescript
/** Record an Overview-tab queue-health read as a `queue.stats.read` span. */
export function recordQueueStatsRead(): void {
  const span = tracer().startSpan('queue.stats.read');
  span.end();
}
```

- [ ] **Step 5: Wire the route + ServerDeps (with the shared optional-dep degrade helper)** — in `src/server/app.ts`:
  - Add `queueConcurrency` to `ServerDeps` as **OPTIONAL** (`?:`), matching the `runLimiter?`/`sessionTokens?`/`staticDir?` precedent (documented: "worker-pool concurrency for the Overview queue card; `computeConcurrency()` value, threaded from main.ts/daemon"):
```typescript
  /** Worker-pool concurrency for the Overview queue card (`computeConcurrency()`,
   *  threaded from main.ts/daemon). Optional — the /api/queue/stats route degrades
   *  to 503 when unset (legacy fixtures need not set it). */
  queueConcurrency?: number;
```
  Making it optional is what lets this task's `ServerDeps` change compile before T11/T20 populate the real value, and keeps the ≥12 existing `const deps: ServerDeps = {…}` fixtures compiling **unedited** (FIX: no fixture-ripple, no temporary stub needed). The Slice-25b ops fields (`queueConcurrency`, `daemonPidPath`, `bindInfo`, `daemonLogDir` — T9/T10 — and `deviceRegistry`, `rootTokens`, `publicBaseUrl` — T15) are ALL optional for this reason.
  - Introduce the **shared assert-present helper + 503 degrade** ONCE here (reused by every ops route that reads an optional dep — T9/T10/T16-T20). At module scope in `app.ts`:
```typescript
/** A Slice-25b ops dep was not wired (the field is optional on ServerDeps so
 *  legacy fixtures need not set it). A route that needs one degrades to 503 with
 *  a clear message rather than throwing an opaque TypeError. */
export class DepUnavailableError extends Error {
  override name = 'DepUnavailableError';
  constructor(readonly field: string) {
    super(`server dependency not configured: ${field}`);
  }
}
/** Narrow an optional ServerDeps field to its required type, or signal a 503. */
export function need<T>(value: T | undefined, field: string): T {
  if (value === undefined) throw new DepUnavailableError(field);
  return value;
}
```
  In `handleApi`'s inner `catch (err)` (the block that currently maps to a 500), add a `DepUnavailableError` branch BEFORE the generic 500 so an unwired ops dep is a clean 503:
```typescript
      } catch (err) {
        if (err instanceof DepUnavailableError) {
          rec.status(503);
          return json({ error: err.message }, 503);
        }
        // Never crash the handler: map the typed error to an actionable JSON body.
        rec.status(500);
        return json({ error: explain(err).title }, 500);
      }
```
  - Import `handleQueueStats`. Add the route inside `handleApi`, BEFORE the `/api/jobs` block for locality (order is exact-path so it doesn't matter, but group the read routes). Build the handler's deps via `need` (so a missing `queueConcurrency` → 503, and the narrowed object typechecks against `QueueStatsDeps`'s required `queueConcurrency`):
```typescript
        if (req.method === 'GET' && url.pathname === '/api/queue/stats') {
          const res = handleQueueStats({
            jobStore: deps.jobStore,
            pool: deps.pool,
            queueConcurrency: need(deps.queueConcurrency, 'queueConcurrency'),
          });
          rec.status(res.status);
          return res;
        }
```
  (Real population of `queueConcurrency` in `main.ts`/daemon lands in T11 — with the field optional there is no typecheck error to work around in the meantime, so no temporary stub is required.)

- [ ] **Step 6: Run — verify green** — `bun test tests/server/queue/stats.test.ts` → PASS. `bun run typecheck` clean.

- [ ] **Step 7: Gate + commit**
```bash
bun run typecheck && bun run lint:file -- src/server/queue/stats.ts src/server/app.ts src/daemon/spans.ts src/server/main.ts tests/server/queue/stats.test.ts
git add src/server/queue/stats.ts src/server/app.ts src/daemon/spans.ts src/server/main.ts tests/server/queue/stats.test.ts
git commit -m "feat(server): GET /api/queue/stats + queue.stats.read span (Slice 25b Incr 2)"
```

