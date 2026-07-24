# Task 18 (Slice 32) — Detection integration test — REPORT

> This report path previously held Slice 25b's Task-18 report; overwritten here
> for Slice 32 Task 18 (self-improvement detection integration).

## Scope done
Integration test proving the two repo-defined self-improvement triggers
(`triggers/index.ts`) enqueue `Eval` jobs end-to-end through the REAL trigger
engine — sync → scheduler/chain → the single `fire.ts` convergence →
`jobStore.enqueue`. Not a re-assert of the static def shapes (Task 17 owned
those); this drives the live wiring.

File added: `tests/triggers/detection-integration.test.ts`

## Harness
Reused the `tests/triggers/engine.test.ts` pattern: real `createJobStore` +
real `createTriggersEngine` over throwaway temp dirs, fake `setInterval`/
`clearInterval` (synthetic `fireTick()`), a fixed `now`, a no-op `watch` seam
(the reeval defs have no File trigger so chokidar is never touched), and the
in-memory `secretStore` stub. Repo registry defaults to the REAL `TRIGGERS`
constant so the actual `reeval-sweep` / `reeval-on-pull` defs are exercised.
Enqueues asserted via `jobStore.listJobs({ limit: 100 })`.

## Two paths exercised
1. **Cron sweep** — after `engine.start()` syncs the repo cron and reconcile
   seeds its `nextRunAt` to the next 4am (future), the test forces it due
   (`store.update(id, { nextRunAt: NOW - 1000 })`) and drives ONE synthetic
   poll tick (`timers.fireTick()`). The scheduler's `claimDueCron` claims it and
   fires through `fire.ts`. Asserts exactly one `JobKind.Eval` job with
   `payload.mode === EvalMode.Sweep`. (Confirmed zero jobs before the tick.)
2. **Pull JobChain** — `engine.handleJobSettled(pullJob, JobStatus.Done)` (the
   chain-observer seam the worker pool invokes on a terminal settle) fires
   `reeval-on-pull`. Asserts exactly one `JobKind.Eval` job with
   `payload.mode === EvalMode.AffectedByPull`.

`fire.ts` is fire-and-forget with a trailing `await createRun`, so each
assertion is preceded by a 25ms settle (same technique as `engine.test.ts`).

## TDD evidence
- A third test injects an EMPTY repo registry (`harness({})`) and asserts
  neither path enqueues an Eval job — proving the wiring, not the harness, is
  what fires.
- Directly verified: temporarily defaulting the harness registry to `{}` made
  BOTH positive tests FAIL (`Expected length: 1 / Received length: 0`) while the
  control still passed; reverted.

## Wiring gap?
NONE found. The real repo defs fire cleanly through the real engine on both
paths. No production code changed — test-only task.

## Gate (per-task)
- `bun run typecheck` — clean.
- `bun run lint:file -- tests/triggers/detection-integration.test.ts` — clean
  (one biome format pass auto-applied).
- `bun run test:file -- "tests/triggers/detection-integration.test.ts"` — 3 pass.
- Full triggers suite (`tests/triggers/`) — 130 pass / 0 fail (unchanged).

## Concerns
- None material. The settle uses a fixed 25ms timeout (mirrors the existing
  engine test); the usual async-settle caveat under heavy CI load applies, but
  it matches the established pattern in this suite.

Commit: 8e741d8 test(self-improve): detection integration — Cron sweep + Pull JobChain enqueue Eval jobs
