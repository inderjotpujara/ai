# Task 10 Report: `withRunStreamSpan` + `handleRunStream` (SSE snapshot-then-tail) — Slice 30b Phase 3 (Runs)

> Note: this file previously held a stale Phase-2 feedback-span report (the
> filename had been reused). Superseded here by the actual Slice-30b **Phase 3**
> live run-stream task.

## Status

**COMPLETE.** Commit `9b4baab`. Typecheck clean, lint 0 errors, both focused
test files green (7 tests total). One real product bug in `run-dto.ts` was
found and fixed (see below).

## TDD flow

1. **Telemetry test (RED→GREEN)** — wrote `tests/telemetry/run-stream-span.test.ts`
   (brief's case + an extra "still records aggregates if fn throws" case
   mirroring `ui-stream-span.test.ts`). Added the five `RUN_STREAM_*` ATTR keys
   next to the `UI_STREAM_*` block and `withRunStreamSpan` right after
   `withUiStreamSpan`. → 2 pass.
2. **Server test (RED)** — wrote `tests/server/runs-stream.test.ts` (brief's 3
   cases + 2 I added: stale-cursor full-replay, and maxWaitMs-bound when
   `spans.jsonl` never appears). Confirmed FAIL: `Cannot find module
   .../stream.ts`.
3. **Server impl (GREEN)** — wrote `src/server/runs/stream.ts`. First run
   surfaced a hang (see "Bug found" below); fixed `run-dto.ts`; → 5 pass.

## Exact commands + output

Focused tests (final):
```
$ bun test --path-ignore-patterns 'web/**' tests/telemetry/run-stream-span.test.ts tests/server/runs-stream.test.ts
 7 pass
 0 fail
 18 expect() calls
Ran 7 tests across 2 files.
```

Regression sweep over every consumer of the changed shared helper:
```
$ bun test --path-ignore-patterns 'web/**' tests/run/ tests/server/ tests/telemetry/
 145 pass
 0 fail
 419 expect() calls
Ran 145 tests across 34 files.
```

Gate:
```
$ bun run typecheck        → clean (tsc --noEmit, no output)
$ bun run lint:file -- "src/telemetry/spans.ts" "src/server/runs/stream.ts" \
    "src/run/run-dto.ts" "tests/telemetry/run-stream-span.test.ts" \
    "tests/server/runs-stream.test.ts"
  → Checked 5 files. No fixes applied. (0 errors, 0 warnings)
```

## Files

- **Modified `src/telemetry/spans.ts`** — added `RUN_STREAM_CHUNKS/BYTES/RESUMES/OUTCOME/RUN_ID`
  ATTR keys next to the `UI_STREAM_*` block, and `withRunStreamSpan` (opens a
  `runs.stream` span, tags `SERVER_ROUTE` + `RUN_STREAM_RUN_ID`, aggregates
  chunks/bytes/resumes/outcome in a `finally` so they land even if `fn` throws
  — verified by the throw test).
- **Created `src/server/runs/stream.ts`** — `handleRunStream(id, deps, opts)`.
- **Modified `src/run/run-dto.ts`** — bug fix to `runRootSummary` (5th file; see
  below).
- **Created** the two test files.

## Bug found + fixed (`run-dto.ts` `runRootSummary`) — the key correctness decision

The brief's snapshot-tail test appends `agent.run` (spanId `root`, closed) as a
**sibling** of the already-present `agent.delegation` span `s1` (both
`parentSpanId: null`, both `startUnixNano: 0`). On first run the test **timed
out at maxWaitMs** — the tail never stopped because `mapRunToDto` kept reporting
`lifecycle: running` even after the closed `agent.run` root was written.

Root cause: `runRootSummary` derived lifecycle/duration/outcome from `tree[0]`
only. With two top-level roots at equal start time, stable sort keeps the
delegation span first, so `RUN_ROOT_NAMES.has(tree[0].name)` was false and the
run read as perpetually `Running`. I verified this directly with a probe
(`lifecycle=running, roots=[s1, root]`).

This is a **real latent product bug**, not just a test artifact: OTel writes a
span only on `.end()`, so while a run's root span is still open its already-
closed child spans are written first as **orphan roots** (their parent isn't in
`spans.jsonl` yet). In the normal case those children carry a real
`parentSpanId` and re-parent under the run-root once it's written, so `tree[0]`
becomes the run-root — which is why existing single-root tests passed. But a
**torn trace** (a parent span that never gets written, e.g. a crash) leaves a
genuine orphan sibling root that can sort ahead of the closed run-root, making
the run read as `Running` forever in **both** the detail view and the list view
(they share `runRootSummary`). This first live-tail consumer is exactly what
surfaces it — the tail would never terminate.

Fix: derive `runRootPresent`/`durationMs`/status/outcome from the recognized
run-root among **all** top-level roots (`roots.find(s => RUN_ROOT_NAMES.has(s.name))`),
keeping `startMs` as the earliest root (`tree[0]`). Minimal and general; all 145
run/server/telemetry tests stay green (existing single-root cases are
unaffected since there tree[0] *is* the run-root).

I judged fixing the shared helper (owning the product bug, per repo norms) the
correct call over papering it over in the transport layer by re-deriving
run-root names inside `stream.ts` — that would have left the list view still
buggy and duplicated domain knowledge. It is a 5th file beyond the brief's
declared set; staged explicitly, documented in the commit body.

## Other correctness decisions

- **Stale/unknown `Last-Event-ID` → full-snapshot replay (not silent nothing).**
  The brief's naive seed loop (`for … { emitted.add(id); if (id===cursor) break }`)
  marks **all** spans emitted when the cursor isn't found, replaying nothing. I
  guard with `dto.spans.some(s => s.spanId === cursor)` and only seed when the
  cursor is present; otherwise the emitted set stays empty and the full snapshot
  replays (degrade to a fresh connection). `rec.resume()` is still recorded
  whenever a `lastEventId` was supplied (a reconnect happened), independent of
  whether the cursor resolved. Covered by an added test (`stale/unknown
  Last-Event-ID replays the full snapshot`).
- **Always closes.** `controller.close()` is in a `finally`, so the reader's
  `collect()` always terminates — verified by every server test completing (a
  hang would time out, as the pre-fix run demonstrated).
- **Degrade, never crash.** A mid-tail throw (e.g. `mapRunToDto` /
  `RunDtoSchema.parse` failing on a torn projection) is caught → `rec.outcome('error')`
  → clean close. Never throws out of the stream. The `withRunStreamSpan` promise
  is `void`-ed inside `start()` but its `fn` catches internally, so no unhandled
  rejection.
- **Bounded when `spans.jsonl` never appears.** The loop checks `signal.aborted`
  and the `maxWaitMs` deadline at the top of each iteration before polling;
  `mapRunToDto` returns `undefined` (no spans) so it just sleeps until the
  deadline, then `rec.outcome('aborted')` + close. Covered by an added test
  (empty run dir, `maxWaitMs: 60` → `[]`, no hang).
- **Frame/headers exactly per spec**: `id: <spanId>\ndata: <json>\n\n`;
  `content-type: text/event-stream`, `cache-control: no-store`, plus
  `ISOLATION_HEADERS`. 404 (JSON body + isolation headers) on `MediaPathError`
  from `confineToDir`, matching `handleRunDetail`.

## Commit

`9b4baab feat(server): runs.stream span + handleRunStream (SSE snapshot-then-tail
+ Last-Event-ID resume)` — staged exactly 5 files
(`src/telemetry/spans.ts`, `src/server/runs/stream.ts`, `src/run/run-dto.ts`,
`tests/telemetry/run-stream-span.test.ts`, `tests/server/runs-stream.test.ts`);
never `git add -A` (tree carries unrelated dirty `.superpowers/sdd/*` +
`.remember/*` bookkeeping). `git commit --stat` confirms 5 files, 405
insertions.

## Concerns

- **`run-dto.ts` change is outside the brief's declared file list.** It is a
  correct, test-driven bug fix (the brief's own test can't pass without it), but
  the slice reviewer / controller should be aware a shared helper used by both
  the runs list and detail views changed. All 145 run/server/telemetry tests
  pass, so no regression, but the list-view projection (`summarizeRunListItem`)
  now also correctly reports Done/Failed for torn-trace runs where it previously
  said Running — a behavior change (a fix) that any list-view snapshot tests
  should welcome, and none broke.
- **Two lint warnings from the brief's verbatim test code** (`res.body!`,
  `first[0]!` → `noNonNullAssertion`) were rewritten to explicit guards to keep
  the touched-file lint at 0 warnings.
- No `console.log`, no type/lint suppressions.

---

## Fix follow-up (review Important finding) — client-disconnect leak + unhandled rejection

Commit `c1c514c fix(server): handleRunStream cancel() handler + guarded close (client-disconnect leak)`.

**Problem (review):** the `ReadableStream` had no `cancel()` and the `finally`
called `controller.close()` unguarded. On client disconnect: (a) the poll loop
kept reading disk up to `maxWaitMs` (600s) for an abandoned run, and (b)
`close()` on the already-cancelled controller threw → rejected the `void`-ed
`withRunStreamSpan()` promise → unhandled rejection.

**Fix (`src/server/runs/stream.ts`):**
1. Added an internal `AbortController`; the `ReadableStream`'s `cancel()` calls
   `internal.abort()`. The loop's stop check is now `opts.signal?.aborted ||
   internal.signal.aborted || Date.now() > deadline`, so a reader disconnect
   ends the loop on the next poll (`pollMs`) instead of running to `maxWaitMs`.
2. The enqueue loop bails on `internal.signal.aborted` before `controller.enqueue`,
   so it never writes onto a cancelled controller mid-snapshot.
3. The `finally` `controller.close()` is wrapped in `try/catch` (swallow), so
   closing an already-cancelled/errored controller never rejects the span promise.

**Test added (`tests/server/runs-stream.test.ts`):** `reader cancel() stops the
tail promptly without throwing` — in-flight run (Running), `maxWaitMs: 5_000`,
`pollMs: 10`; read the snapshot frame, `reader.cancel()`, wait 80ms, then assert
(a) the `runs.stream` span finished with `RUN_STREAM_OUTCOME === 'aborted'` —
which can only happen well before the 5s deadline if the cancel handler stopped
the loop (proves prompt stop), and (b) no `unhandledRejection` fired during the
window (proves the guarded close). Verified meaningful: temporarily removing the
`cancel()` handler makes this test FAIL (loop doesn't terminate in-window), then
restored.

Minors left AS-IS per review triage (flatten-order resume seed, RUN_STREAM_BYTES
counting UTF-16 units, silent catch).

**Gate (touched files):**
```
$ bun run typecheck                                              → clean
$ bun run lint:file -- "src/server/runs/stream.ts" "tests/server/runs-stream.test.ts"
  → Checked 2 files. No fixes applied. (0 errors)
$ bun test --path-ignore-patterns 'web/**' tests/server/runs-stream.test.ts tests/telemetry/run-stream-span.test.ts
  → 8 pass / 0 fail (21 expect() calls, 2 files)
```
Committed with `git add` of exactly the 2 files (no amend, no `git add -A`);
pre-commit docs-check passed.
