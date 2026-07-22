# Task 8 Report — `src/a2a/task-map.ts` OrchestratorResult/JobStatus ↔ A2A task-state bijection (Slice 31, Incr 3)

**Status:** DONE. Commit `0d746e4` — `feat(a2a): OrchestratorResult/JobStatus ↔ A2A task-state bijection`. Branch `slice-31-a2a-multimachine`. Model: Opus.

(Note: `task-8-report.md` is reused per slice; the sections below this one are Slice 25b / Slice 25 Task 8 and are unrelated to Slice 31.)

## Implemented — pure, I/O-free mappers in `src/a2a/task-map.ts`
- `orchestratorResultToTaskState(r)` — `answer→Completed`; `gap`/`resource→Failed` (early return for `answer`, else `Failed`; a failure can never reach `Completed`).
- `orchestratorResultToArtifact(r)` — `answer` → one text-part artifact (`ArtifactSchema.parse`d; `artifactId` via `randomUUID()`; `parts:[{kind:'text',text:r.text}]`); `gap`/`resource` → `undefined`.
- `resultToTaskError(r)` — `gap → {code:-32001,message:'missing-capability',data:{missingCapability}}`; `resource → {code:-32002,message:r.message}`; `answer → undefined`.
- `jobStatusToTaskState(s)` — `Queued→Submitted, Running→Working, Done→Completed, Failed→Failed, Canceled→Canceled, Interrupted→Failed`. Exhaustive `switch` with `const _exhaustive: never = s` default → compile-time totality.
- `CONSENT_UNAVAILABLE_ERROR_CODE = -32003` + `consentUnavailableError()` (message `'consent-unavailable'`) — fail-closed mid-run-consent typed error, reused by Task 13. Also exported `MISSING_CAPABILITY_ERROR_CODE`/`RESOURCE_ERROR_CODE`.

Confirmed against source: `OrchestratorResult` union (`core/orchestrator.ts:21-24`), `JobStatus` 6 members (`queue/types.ts:3-10`), `TaskStateWire` + `ArtifactSchema` (`artifactId`+`parts` required) from `contracts/a2a.ts`. `TaskStateWire.InputRequired`/`AuthRequired` left in enum, never emitted this slice.

## TDD RED → GREEN
- **RED:** `bun run test:file -- "tests/a2a/task-map.test.ts"` → `Cannot find module '../../src/a2a/task-map.ts'` (0 pass, 1 fail/error).
- **GREEN:** after implementation → `9 pass / 0 fail / 27 expect() calls`.
- Tests: 4 brief tests verbatim + probes — gap `data.missingCapability`+code, resource `message==r.message`, gap/resource → no artifact, a `Record<JobStatus,…>` loop asserting every member maps (and Failed/Interrupted/Canceled ≠ Completed), and `CONSENT_UNAVAILABLE_ERROR_CODE===-32003` + message `'consent-unavailable'`.

## Gate (inline)
- `bun run typecheck` → clean (`tsc --noEmit`) — confirms the `never` default compiles, so totality holds.
- `bun run lint:file -- src/a2a/task-map.ts tests/a2a/task-map.test.ts` → 3 auto-fixable nits (import sort + formatting), fixed via `--write`; re-check clean.
- pre-commit `docs-check` passed.

## Files changed
- `src/a2a/task-map.ts` (new), `tests/a2a/task-map.test.ts` (new)

## Self-review (§7.1)
- **Totality (OrchestratorResult):** all 3 variants mapped in every fn; state fn returns `Failed` for the non-`answer` tail.
- **Totality (JobStatus):** all 6 `case`s + `never` default → a new member fails to compile. No default-to-completed hole.
- **No failure→completed:** only `answer` and `Done` yield `Completed`; asserted by negative tests.
- **No untrusted-text-as-instruction:** result text/message carried only as inert artifact-part text / error `data` / error `message`; never interpolated into anything executable (pure mappers, no I/O).

## Concerns
- None blocking. `orchestratorResultToArtifact` mints a fresh `artifactId` (`randomUUID()`, non-deterministic) per call — schema-valid (id required, none caller-supplied in this signature); Task 9 can override if a stable id is later needed.

---

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

## Fix wave (§7.1 totality symmetry)

Two small fixes to `src/a2a/task-map.ts` giving the `OrchestratorResult` mappers the
same compile-time totality guarantee the `JobStatus` switch already had.

- **Fix 1 — compile-enforce OrchestratorResult totality.** Converted the three
  `if/else` mappers (`orchestratorResultToTaskState`, `orchestratorResultToArtifact`,
  `resultToTaskError`) to `switch (r.kind)` with a `default` tail
  `const _exhaustive: never = r;`. A future 4th `OrchestratorResult` variant now fails
  `tsc` in all three instead of silently returning `Failed`/`undefined` (the
  Failed-with-no-error desync). Runtime behavior for the current 3 variants is
  unchanged: answer→Completed+artifact+no-error; gap→Failed+{-32001,'missing-capability',
  data.missingCapability}; resource→Failed+{-32002,message}.
- **Fix 2 — derive TaskError from the contract.** Replaced the hand-rolled
  `type TaskError = { code; message; data? }` with `type TaskError = JsonRpcError`
  (imported from `../contracts/index.ts`, i.e. `z.infer<typeof JsonRpcErrorSchema>`),
  used by `resultToTaskError` / `consentUnavailableError`. Shapes verified compatible
  (code:number, message:string, data?:unknown) so a schema change can't drift a
  duplicate. Typecheck passing is the proof the derived type still satisfies every call site.

**Gate — `tsc` passes (this is what proves Fix 1's guard):**

```
$ bun run typecheck
$ tsc --noEmit
(no output — clean)

$ bun run lint:file -- src/a2a/task-map.ts tests/a2a/task-map.test.ts
Checked 2 files in 5ms. No fixes applied.
```

**Tests — all 9 original stay green + 1 added (10 total):**

```
$ bun run test:file -- "tests/a2a/task-map.test.ts"
 10 pass
 0 fail
 35 expect() calls
Ran 10 tests across 1 file.
```

The added test (`a Failed projection always carries a defined typed error (gap + resource)`)
asserts the guard's runtime-observable intent — every non-answer result that maps to
`Failed` also yields a defined `JsonRpcError` (no Failed-with-no-error desync). No existing
test was weakened.
