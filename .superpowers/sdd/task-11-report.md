# Task 11 Report — Wire the new `ServerDeps` fields in `main.ts` + the daemon injection (Slice 25b Ops Console, Increment 2)

> Note: this path previously held a Task-11 report for an unrelated Slice
> 30b Phase 8 unit (`use-voice-input.ts` streamed interim text) — task
> numbers are reused per-slice, and that content has been fully replaced by
> this report. That work is preserved in its own commits (`8012726` etc.)
> and is unaffected by this overwrite.

## Status: DONE

## What was wired, per site

### `src/server/main.ts`
- `StartOptions.queue` extended from `{ jobStore; pool }` to
  `{ jobStore; pool; concurrency: number }` — `concurrency` is REQUIRED, not
  optional, so a caller that injects a queue must also supply the value it
  built the pool with. This is the load-bearing part of the one-pool/one-
  concurrency invariant: main.ts's injected branch now reads
  `queueConcurrency = injected.concurrency` and never calls
  `computeConcurrency()` on that path — only the standalone (`else`) branch
  calls it, exactly once, and reuses that same local to build the pool.
- `StartOptions` gained `daemonPidPath?: string` and `daemonLogDir?: string`.
- Added a `bindInfo` local (sibling to the existing `policy` local) built
  from the exact `bind`/`allowedHosts`/`port` locals already used for
  `policy`, plus `sessionTtlMs` from
  `opts.sessionTtlMs ?? cfg.AGENT_WEB_SESSION_TTL_MS`. Like `policy.port`,
  `bindInfo.port` is reconciled to the real bound port right after
  `Bun.serve()` resolves an ephemeral `port: 0` — this was a gap in the
  brief's literal code sample (an inline object copies `port` by value at
  deps-construction time, before the ephemeral port is known), which I
  caught and fixed by promoting it to a mutable local exactly like `policy`.
- `deps.daemonPidPath = opts.daemonPidPath ?? defaultPidPath()` (imported
  from `../daemon/pid.ts`).
- `deps.daemonLogDir = opts.daemonLogDir ?? join(dirname(defaultPidPath()), 'logs')`
  — resolves to the same value `defaultLogDir()` in `src/cli/daemon.ts`
  produces (`join(defaultPidPath(), '..', 'logs')` normalizes identically);
  not a shared import because `cli/daemon.ts`'s `defaultLogDir` isn't
  exported — both are independent expressions of "sibling `logs/` dir next
  to the pid file."

### `src/daemon/core.ts`
- `CreateDaemonOptions.concurrency: number` added (required).
- The injected `startWebServer({ queue: { jobStore, pool } })` call now also
  passes `concurrency: opts.concurrency`.
- Top-of-file doc comment (the numbered lifecycle steps) updated to mention
  step 5 now threads `concurrency` too.

### `src/cli/daemon.ts` (`buildRealDaemon`)
- Hoisted `const concurrency = computeConcurrency();` — ONE call, shared by
  both `createWorkerPool({ ..., concurrency })` and
  `createDaemon({ ..., concurrency })`. This is the proof site for "hoist to
  a local so pool + daemon share one number," per the brief and the
  Slice-24 audit lesson (no second, independently-computed concurrency
  value).

## One-pool / one-concurrency-value invariant — proof

- **Standalone** (`bun run web` / all-in-one tests): `main.ts`'s `else`
  branch is the ONLY place `computeConcurrency()` is called; the resulting
  local feeds both `createWorkerPool` and `deps.queueConcurrency`. No second
  pool, no second concurrency source.
- **Daemon-injected** (`agent daemon start-foreground`): `buildRealDaemon()`
  in `cli/daemon.ts` is the ONLY place `computeConcurrency()` is called on
  that path; the one local feeds `createWorkerPool` (the ONE pool) and
  `createDaemon({ concurrency })`, which threads it unchanged through
  `core.ts`'s `startWebServer({ queue: { concurrency } })` call into
  `main.ts`'s injected branch, which reads `injected.concurrency` directly —
  `main.ts` never calls `computeConcurrency()` on this path at all, so the
  reported number and the pool's real concurrency cannot diverge.

## TDD RED/GREEN

- RED (pre-existing, confirmed unaffected): `tests/server/app.test.ts`'s
  503 tests construct `ServerDeps` directly without the four fields and
  assert 503 — still green after this change (that fixture is deliberately
  unwired; the optional fields keep it compiling unedited).
- New: `tests/server/main-ops-deps.test.ts` boots a REAL standalone
  `startWebServer` (temp `AGENT_QUEUE_PATH`, temp auth dir, explicit
  `daemonPidPath`/`daemonLogDir`) and asserts `/api/daemon/status`,
  `/api/queue/stats`, and `/api/daemon/logs` all return 200 with sane
  bodies (`bind.port` matches the real bound ephemeral port,
  `concurrency > 0`, `lines: []` for a not-yet-existing log dir). Confirmed
  this test fails (503s) against the pre-edit code, then passes after the
  wiring landed.
- Knock-on compile fixes (required once `queue.concurrency` and
  `CreateDaemonOptions.concurrency` became non-optional):
  `tests/daemon/core.test.ts` (3 `createDaemon(...)` calls),
  `tests/daemon/restart-durability.integration.test.ts` (2 calls), and
  `tests/server/main-queue-boot.test.ts` (1 injected-queue object literal)
  each needed a `concurrency` value added. These are mechanical (arbitrary
  positive integers — the fixtures assert on daemon start/stop/reconcile
  ordering, never on the concurrency number itself) — no behavior changed.

## Gate results

- `bun run typecheck` — clean.
- `bun run lint:file -- src/server/main.ts src/cli/daemon.ts src/daemon/core.ts tests/server/main-ops-deps.test.ts tests/daemon/core.test.ts tests/daemon/restart-durability.integration.test.ts tests/server/main-queue-boot.test.ts` — clean (biome, no fixes needed).
- `bun test tests/server/ tests/daemon/` — 349 pass, 0 fail, 899 expect() calls, across 76 files.

## Files changed

- `/Users/inderjotsingh/ai/src/server/main.ts`
- `/Users/inderjotsingh/ai/src/daemon/core.ts`
- `/Users/inderjotsingh/ai/src/cli/daemon.ts`
- `/Users/inderjotsingh/ai/tests/server/main-ops-deps.test.ts` (new)
- `/Users/inderjotsingh/ai/tests/daemon/core.test.ts` (knock-on: `concurrency` field)
- `/Users/inderjotsingh/ai/tests/daemon/restart-durability.integration.test.ts` (knock-on: `concurrency` field)
- `/Users/inderjotsingh/ai/tests/server/main-queue-boot.test.ts` (knock-on: `concurrency` field on injected queue)

## Concerns

- One deliberate deviation from the brief's literal code sample: `bindInfo`
  is a mutable local (mirroring `policy`) rather than an object inlined
  directly into the `deps` literal, specifically so `bindInfo.port` gets
  reconciled to the real bound port after an ephemeral `port: 0` resolves —
  the literal sample as written would have silently reported port `0` in
  that case. This is strictly more correct and changes no interface, so I
  did not treat it as a NEEDS_CONTEXT stop.
- The `concurrency` values chosen for the three knock-on test fixes are
  arbitrary placeholders — none of those tests assert on the concurrency
  number, only on daemon lifecycle ordering.
- Files outside the brief's explicit list (`tests/daemon/core.test.ts`,
  `tests/daemon/restart-durability.integration.test.ts`,
  `tests/server/main-queue-boot.test.ts`) needed edits purely to keep the
  build green once `concurrency` became a required field — flagging this
  explicitly since the brief's "Files" section didn't name them.

## Commit

`c0ddc87` — `feat(server): wire queueConcurrency/pidPath/bindInfo/logDir into ServerDeps` (branch `slice-25b-ops-console`)
