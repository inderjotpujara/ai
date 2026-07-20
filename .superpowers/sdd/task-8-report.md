# Task 8 Report — `GET /api/queue/stats` + shared `need()`/503 dep-guard (Slice 25b Incr 2)

**Status:** DONE. Commit `f4a40d0` — `feat(server): GET /api/queue/stats + queue.stats.read span (Slice 25b Incr 2)`.

(Note: this filename was reused by earlier Slice-30b Task 8 reports; this report supersedes them for Slice 25b.)

## What shipped
- **`src/server/queue/stats.ts`** (new): `handleQueueStats(deps)` → 200 `QueueStatsDTO`.
  `counts`+`total` from `deps.jobStore.stats()`'s single race-free snapshot; DTO produced via
  `QueueStatsDtoSchema.parse(...)`. `QueueStatsDeps.pool` is `Pick<WorkerPool,'activeCount'>`.
- **`src/daemon/spans.ts`**: added `recordQueueStatsRead()` — a `queue.stats.read` span following the
  `recordJobEnqueue` no-op pattern (non-recording + ended without a tracer). Called from the handler.
- **`src/server/app.ts`**:
  - `ServerDeps.queueConcurrency?: number` — **OPTIONAL** (matches the `runLimiter?`/`sessionTokens?`/`staticDir?`
    precedent). Keeps the ~12 existing `const deps: ServerDeps = {…}` fixtures compiling **unedited**.
  - **Shared dep-guard, introduced once at module scope** (reused by T9/T10/T16-20):
    - `export class DepUnavailableError extends Error` with `override name = 'DepUnavailableError'` + `readonly field`
      (message `server dependency not configured: <field>`).
    - `export function need<T>(value: T | undefined, field: string): T` — returns the value or throws
      `DepUnavailableError`. `need(0, …)` returns `0` (only `undefined` is "missing").
  - **503 branch in `handleApi`'s inner `catch (err)`**, placed BEFORE the generic 500: `err instanceof
    DepUnavailableError → rec.status(503); json({error: err.message}, 503)`.
  - Route wired inside `handleApi` immediately BEFORE the `/api/jobs` block (grouped with reads). Deps built with
    `need(deps.queueConcurrency, 'queueConcurrency')` — unwired dep 503s, and the narrowed object typechecks
    against `QueueStatsDeps`' required `queueConcurrency`.
- **`src/server/main.ts`**: threaded the standalone pool's exact `computeConcurrency()` value into
  `deps.queueConcurrency` (hoisted into a `let queueConcurrency` set where the pool is built). The injected
  (daemon) path leaves it `undefined` on purpose → clean 503 rather than a guessed number; the daemon's real
  value is threaded in **T11** (per the brief's deferral note).

## activeCount as a DISTINCT field (§7.2) — confirmed
`activeCount` is written straight from `deps.pool.activeCount()` into its own DTO field — **never** reconciled by
arithmetic with the DB `running` count from `stats().counts`. The DTO schema (T3) keeps them separate; the handler
doc-comment states the "running rows" vs "active workers" distinction.

## `need()`/503 shared-helper shape (for downstream tasks)
```ts
export class DepUnavailableError extends Error {
  override name = 'DepUnavailableError';
  constructor(readonly field: string) { super(`server dependency not configured: ${field}`); }
}
export function need<T>(value: T | undefined, field: string): T {
  if (value === undefined) throw new DepUnavailableError(field);
  return value;
}
```
Both exported from `src/server/app.ts`. T9/T10/T16-20 import `need` and wrap their optional deps the same way; the
`handleApi` 503 branch already maps any `DepUnavailableError` thrown anywhere in the ladder.

## How the legacy ServerDeps fixtures stayed green
`queueConcurrency` is optional, so no fixture needed editing. Verified via `bun run typecheck` (clean) and by
running the full `tests/server/` suite (all fixtures across 66 files construct/serve without a compile or runtime
break). The `app.test.ts` fixture (which omits `queueConcurrency`) doubles as the 503 proof.

## TDD RED → GREEN
- **RED:** wrote `tests/server/queue/stats.test.ts` first → failed with `Cannot find module '.../stats.ts'`.
- **GREEN:** implemented the handler → the 200 test passes (`total=1`, `counts.queued=1`, `concurrency=4`,
  `activeCount=0`).
- Added the brief-named **`need()`/503 test**: a unit test over `need`/`DepUnavailableError` (present value,
  `0`-is-present, throws-when-undefined, field/name/message) AND a route-level test in `app.test.ts` hitting
  `GET /api/queue/stats` against the queueConcurrency-less fixture, asserting a real **503** with body
  `{error:'server dependency not configured: queueConcurrency'}` — exercising the shared 503 seam through the real
  `handleApi`.

## Gate results (inline)
- `bun run typecheck` — clean (added a `QueueStatsDTO` cast on `await res.json()`; the brief's verbatim test was
  `unknown` under strict tsc).
- `bun run lint:file` on all 6 changed files — clean (biome reordered stats.ts imports + wrapped a `.toThrow`).
- `bun test` touched files — 18 pass / 0 fail.
- `bun test tests/server/` sanity — **302 pass / 0 fail** across 66 files.

## Files changed
- `src/server/queue/stats.ts` (new), `tests/server/queue/stats.test.ts` (new)
- `src/server/app.ts`, `src/daemon/spans.ts`, `src/server/main.ts`, `tests/server/app.test.ts`

## Concerns / notes for the controller
- **main.ts injected/daemon path**: `queueConcurrency` intentionally left unset in injected mode → 503 until **T11**
  threads the daemon's real concurrency through `opts.queue`. The brief deferred this; I only wired the
  unambiguously-correct standalone value so `bun run web` + all-in-one tests get a working route now. If the
  controller prefers zero main.ts change this task, the main.ts edit is trivially revertible (route still 503s).
- Living-doc surfaces (architecture.md / README / ROADMAP / SDD ledger / Artifact) not touched here — those are the
  increment/slice-boundary job, not per-task.
- `git add` was file-scoped (6 files); unrelated `.remember/` + `.superpowers/sdd/*` ledger/scratch files remain
  unstaged as instructed.

---

# Task 8 Report — Trigger config knobs + telemetry ATTR keys + trigger spans (Slice 25, Task 8)

**Status:** DONE. Commit `7a52598` — `feat(triggers): config knobs + telemetry ATTR keys + trigger spans`.

(Note: this filename was reused again — the section above is Slice 25b's own Task 8 (queue/stats); this
section is Slice 25 Task 8 (triggers config + telemetry), a different slice/branch (`slice-25-triggers`).)

## What shipped
- `src/config/schema.ts`: appended a "Triggers (Slice 25)" `CONFIG_SPEC` group — `AGENT_TRIGGERS_POLL_MS`
  (number, def 1000), `AGENT_TRIGGERS_MAX_CHAIN_DEPTH` (number, def 8), `AGENT_TRIGGERS_WATCH_ROOT`
  (string, def `~/.agent/inbox`), `AGENT_TRIGGERS_ENABLED` (boolean, def false). No `AGENT_TRIGGERS_PATH`
  knob (dropped, no consumer) — verified by a test asserting it's absent from `loadConfig({})`.
- `src/telemetry/spans.ts`: added `TRIGGER_ID`/`TRIGGER_TYPE`/`TRIGGER_ORIGIN`/`TRIGGER_OUTCOME` to `ATTR`
  (dotted `trigger.*` namespace), placed after the Slice-24 `JOB_ORIGIN` entry with a comment noting the
  webhook-token/secretRef must never be set as a span attribute.
- `src/triggers/spans.ts` (new): mirrors `src/daemon/spans.ts` exactly — module-local
  `tracer = () => trace.getTracer('agent')`, reuses `inSpan`/`ATTR` from `telemetry/spans.ts` (no parallel
  emission path). `recordTriggerRegister(t)` and `recordTriggerSkip(t, outcome)` are one-shot
  `tracer().startSpan(...)` + `.end()`; `withTriggerFireSpan(t, fn)` opens via `inSpan('trigger.fire', ...)`
  and exposes `rec.outcome(o)` which sets `ATTR.TRIGGER_OUTCOME`. All three tag `TRIGGER_ID`/`TYPE`/`ORIGIN`.

## TDD RED -> GREEN
- Wrote `tests/config/trigger-knobs.test.ts` (defaults + env overrides + the no-`AGENT_TRIGGERS_PATH`
  negative check) and `tests/triggers/spans.test.ts` (brief's verbatim no-tracer no-op test, plus a
  `describe` block using `tests/helpers/otel-test-provider.ts`'s `registerTestProvider()` to assert real
  span names/attributes for register/fire/skip, and a secret-leak negative check) before implementing —
  both failed on missing modules, then passed after the `schema.ts`/`spans.ts`/`triggers/spans.ts` edits.
- Note: the no-tracer test and the provider-backed tests are split via a nested `describe` so the
  provider's `beforeAll` doesn't leak into the top-level no-op assertions (bun's `beforeAll` scopes to its
  enclosing describe, but only if the no-op tests sit outside it).

## Gate results (inline)
- `bun run typecheck` — clean.
- `bun run lint:file -- src/config/schema.ts src/telemetry/spans.ts src/triggers/spans.ts tests/triggers/spans.test.ts tests/config/trigger-knobs.test.ts`
  — clean (biome auto-fixed one quote-style nit in schema.ts and one import-wrap in the trigger spans test;
  re-ran lint after to confirm clean).
- `bun test tests/config/trigger-knobs.test.ts tests/triggers/spans.test.ts tests/config/schema.test.ts tests/daemon/spans.test.ts`
  — 26 pass / 0 fail (sanity-included the pre-existing schema/daemon-spans suites to confirm no regression).

## Files changed
- `src/config/schema.ts`, `src/telemetry/spans.ts` (modified)
- `src/triggers/spans.ts`, `tests/triggers/spans.test.ts`, `tests/config/trigger-knobs.test.ts` (new)

## Concerns / notes for the controller
- `git add` was file-scoped to exactly these 5 files; unrelated `.remember/` + `.superpowers/sdd/*`
  briefs/reports modified by other in-flight parallel tasks on this branch were left unstaged.
- `src/triggers/types.ts` (Trigger/TriggerType/TriggerOrigin/TriggerOutcome) already existed pre-task
  (presumably from an earlier trigger-types task) — consumed as-is, not modified.
- No consumer wires these knobs/spans yet (scheduler.ts, fire.ts, watcher.ts, confine.ts don't exist yet) —
  this task is purely the config+telemetry seam per the brief; later engine tasks read `AGENT_TRIGGERS_*`
  and call into `triggers/spans.ts`.
