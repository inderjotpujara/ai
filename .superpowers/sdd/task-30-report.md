# Task 30 report — daemon + queue telemetry spans (item 18)

## Spans emitted

| Span | Emitted from | Attributes |
|---|---|---|
| `daemon.start` | `src/daemon/core.ts` via `recordDaemonStart` (unchanged call site, T27) | `daemon.pid` |
| `daemon.stop` | `src/daemon/core.ts` via `recordDaemonStop` (unchanged call site) | `daemon.pid` |
| `job.enqueue` | `src/server/jobs/enqueue.ts`, right after `jobStore.enqueue()` persists | `job.id`, `job.kind`, `job.priority`, `agent.run.id`, `job.origin=daemon`, `server.principal=local` |
| `job.run` | `src/queue/pool.ts` `runOne`, wraps `executor(job, signal)` | `job.id`, `job.kind`, `job.priority`, `job.attempt`, `agent.run.id`, `job.origin=daemon`; ERROR status on throw |
| `job.retry` | `src/queue/pool.ts` `runOne`'s catch, only when `markFailed` re-queues (post-write `getJob` shows `Queued`) | same job attrs + `job.attempt` (the attempt that just failed) |
| `job.cancel` | `src/queue/pool.ts` `cancel()`, for a Running job (pool owns the `AbortController`) | same job attrs |

## Where/how (no parallel telemetry path)

- `src/daemon/spans.ts` (enriched, not replaced) is the ONE seam for all six helpers: `recordDaemonStart/Stop` (T27, untouched call sites) plus new `recordJobEnqueue`, `withJobRunSpan`, `recordJobRetry`, `recordJobCancel`.
- Reuses the project's own `inSpan` (`src/telemetry/spans.ts`) — promoted from module-private to `export` so daemon/spans.ts doesn't hand-roll a second try/catch/finally-around-`startActiveSpan`. `withJobRunSpan` wraps `withRunContext(job.runId, () => inSpan('job.run', ...))` (`src/telemetry/run-router.ts:101`), so a job's span — and anything the executor itself emits inside it (`agent.run`, `chat.run`, etc.) — routes through the run's own registered processors, same nesting every other `withRunSpan`-style caller relies on.
- All new `ATTR.*` constants (`DAEMON_PID`, `JOB_ID`, `JOB_KIND`, `JOB_PRIORITY`, `JOB_ATTEMPT`, `JOB_ORIGIN`) live in the central `ATTR` map in `src/telemetry/spans.ts` (the T27 stub's own comment said `ATTR_DAEMON_PID` gets promoted here once the full set lands — done). `agent.run.id`/`server.principal` are the EXISTING `ATTR.RUN_ID`/`ATTR.SERVER_PRINCIPAL` constants, reused verbatim, not re-declared.

## Provenance (item 17/18 tie-in)

Every job span sets `job.origin = RunOrigin.Daemon` (`src/contracts/enums.ts`) — the SAME enum value `dispatch.ts`'s `markDaemonOrigin` already writes to `runs/<runId>/origin` for item 17 — so a job's spans agree with `readRunOrigin()`'s DTO projection for the same run. `job.enqueue` additionally tags `server.principal = 'local'`, mirroring `withServerRequestSpan`'s convention (reserved value until Slice 35's audit-grade principal). Every job span also carries `agent.run.id` so it's directly correlatable to the run's own `agent.run`/`chat.run` root span.

## Brief vs. task-description reconciliation

- The brief's Interfaces section specifies `recordDaemonStart({pid})`/`recordDaemonStop({pid})` unchanged in shape (no concurrency/reconciled-count attrs); the surrounding task-description prose suggested richer daemon attributes, but since the brief is the exact-attribute source of truth and no step asked for those fields, I kept `daemon.start`/`daemon.stop` at `{pid}` — only promoting the pid constant into the central `ATTR` map, per the existing code comment's own stated intent. Flagging this as a deliberate scope-hold, not an oversight; adding concurrency/reconciled-count to daemon spans is a small, isolated follow-up if wanted.
- `job.cancel` is emitted only from `pool.cancel()` (the Running-job path the pool owns), matching the brief's file list (`pool.ts` only — not `cancel.ts`/`store.ts`). The Queued-job cancel path in `src/server/jobs/cancel.ts` (`jobStore.markCanceled` called directly, no pool/`AbortController` involved) does NOT emit a span in this pass — a real gap if "every cancel" is wanted, but out of the brief's stated file scope. Documented here as a concern.

## TDD

RED: wrote `tests/daemon/spans.test.ts` (8 tests: daemon start/stop, `job.enqueue` attrs, `withJobRunSpan` nesting via `currentRunId()` + attempt attr, ERROR-status-on-throw, `job.retry`, `job.cancel`) against the enriched-but-not-yet-implemented helpers — confirmed failing (missing exports) before implementing. GREEN: implemented `src/daemon/spans.ts`, wired `src/queue/pool.ts` (`withJobRunSpan` around dispatch, `recordJobRetry` after a `markFailed` re-queue, `recordJobCancel` in `cancel()`) and `src/server/jobs/enqueue.ts` (`recordJobEnqueue` after persist) — all 8 pass.

## Verification

- `bun run typecheck` — clean.
- `bun run lint:file -- src/daemon/spans.ts src/queue/pool.ts src/server/jobs/enqueue.ts src/telemetry/spans.ts tests/daemon/spans.test.ts` — clean (one formatter fix auto-applied to the test file).
- `bun test tests/daemon/ tests/queue/ tests/telemetry/` — 118 pass, 0 fail.
- `bun test tests/server/jobs/` — 21 pass, 0 fail (enqueue/cancel routes unaffected).
- `bun run test` (the project's real gated command, excludes `web/**`/`spikes/**`) — 1699 pass, 36 skip, 0 fail across 408 files. (A raw `bun test` at repo root also picks up `web/**`/`spikes/**`, which fail for pre-existing, unrelated reasons — missing `vi.stubGlobal` under the Bun test runner and a spike file — confirmed unrelated to this change and out of scope per `package.json`'s own `test` script.)
- `bun run docs:check` — clean (no new subsystem; queue/daemon already documented in `docs/architecture.md`).

## Files changed

- `src/telemetry/spans.ts` — added `ATTR.DAEMON_PID/JOB_ID/JOB_KIND/JOB_PRIORITY/JOB_ATTEMPT/JOB_ORIGIN`; exported `inSpan`.
- `src/daemon/spans.ts` — enriched with `recordJobEnqueue`, `withJobRunSpan`, `recordJobRetry`, `recordJobCancel`.
- `src/queue/pool.ts` — wraps `executor()` in `withJobRunSpan`; emits `job.retry` on re-queue, `job.cancel` in `cancel()`.
- `src/server/jobs/enqueue.ts` — emits `job.enqueue` after persist.
- `tests/daemon/spans.test.ts` — new, 8 tests.

## Concerns

1. Queued-job cancel via `src/server/jobs/cancel.ts` (bypasses the pool) has no `job.cancel` span — see reconciliation note above.
2. `daemon.start`/`daemon.stop` stayed at the T27 `{pid}` shape per the brief's exact Interfaces spec, not the richer prose in the task description (concurrency/reconciled-count) — flagged as a deliberate, brief-driven scope decision.
