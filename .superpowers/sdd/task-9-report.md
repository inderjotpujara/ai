# Task 9 Report: `pid.readStartedAt` + extend `GET /api/daemon/status` (uptime + bind) [§7.3]

Note: this filename was previously used for an unrelated Task 9 from Slice
30b Phase 8 (`stt.worker.ts` TextStreamer callback). That content is
superseded — this is Slice 25b "Ops Console" Increment 2's Task 9.

## Status: DONE

## Summary

Implemented exactly per brief `/Users/inderjotsingh/ai/.superpowers/sdd/task-9-brief.md`, TDD steps 1-9 in order, no deviations from the mechanism.

## Implementation

1. **`src/daemon/pid.ts`** — added `readStartedAt(path: string): number | undefined`:
   ```ts
   export function readStartedAt(path: string): number | undefined {
     try {
       return statSync(path).mtimeMs;
     } catch {
       return undefined;
     }
   }
   ```
   Same fail-closed discipline as the rest of the module (`readPid`/`isPidAlive`):
   any read failure collapses to `undefined`, never throws.

2. **`src/daemon/spans.ts`** — added `recordDaemonStatusRead()`, a
   `daemon.status.read` span (no attributes, matching the sibling
   `recordQueueStatsRead` from Task 8 — a bare presence/latency marker for the
   Overview-tab read).

3. **`src/server/daemon/status.ts`** (new) — `handleDaemonStatus(deps)`:
   - `pid = readLivePid(daemonPidPath)` (clears a stale/dead pid, same as the
     CLI `daemon status` path).
   - `startedAt = pid !== undefined ? readStartedAt(daemonPidPath) : undefined`
     — only reads the mtime when the pid is confirmed live, so a stale file
     that `readLivePid` just deleted never contributes a bogus `startedAt`.
   - `uptimeMs = startedAt !== undefined ? Date.now() - startedAt : undefined`.
   - Response validated through `DaemonStatusDtoSchema.parse(...)` (the T3 DTO)
     with the `bind` sub-object passed straight through from `deps.bindInfo`.

4. **`src/server/app.ts`** — `ServerDeps.daemonPidPath?: string` and
   `ServerDeps.bindInfo?: {...}` added as OPTIONAL fields (identical rationale
   comment style to Task 8's `queueConcurrency?`). Route added right after
   `GET /api/queue/stats` (grouped with the other Overview-tab reads):
   ```ts
   if (req.method === 'GET' && url.pathname === '/api/daemon/status') {
     const res = handleDaemonStatus({
       daemonPidPath: need(deps.daemonPidPath, 'daemonPidPath'),
       bindInfo: need(deps.bindInfo, 'bindInfo'),
     });
     rec.status(res.status);
     return res;
   }
   ```
   Reused the exported `need()`/`DepUnavailableError` from Task 8 verbatim —
   no redefinition. The route sits inside `handleApi`, so it's already behind
   the shared bearer/session guard (`guard.verify(req)` in `buildFetch`) and
   the perimeter check — same as every other `/api/*` route.

## The uptime-from-mtime mechanism, and why it's robust (§7.3)

The naive approach — `process.uptime()` in whatever process answers the HTTP
request — is only correct *today* because the web server that answers
`GET /api/daemon/status` happens to run inside the daemon process itself. The
moment status-serving is ever proxied, split into a separate process, or
answered by a different worker (all plausible future shapes for this ops
surface), `process.uptime()` would silently report the *responder's* age, not
the daemon's.

`readStartedAt` sidesteps this by reading `statSync(pidPath).mtimeMs` — the pid
file is written exactly once, at `writePid()` inside `daemon/core.ts`'s
`start()`, and never rewritten while the daemon runs. Its mtime is therefore a
durable, on-disk boot marker that is independent of which process reads it.
Any process with filesystem access — the daemon itself, a future reverse-proxy
process, a CLI invoked from a different shell — computes the identical
`startedAt`/`uptimeMs` from the same file. This is the same "read the durable
artifact, not the responder's in-memory state" discipline the rest of the pid
module already follows (`readLivePid` re-validates liveness from the file
rather than trusting an in-memory flag).

## TDD RED → GREEN

**RED** (both new test files, before implementation):
```
tests/daemon/pid-started-at.test.ts:
SyntaxError: Export named 'readStartedAt' not found in module '.../src/daemon/pid.ts'.
tests/server/daemon/status.test.ts:
error: Cannot find module '.../src/server/daemon/status.ts'
0 pass / 2 fail / 2 errors
```

**GREEN** (after implementing `readStartedAt`, `recordDaemonStatusRead`,
`handleDaemonStatus`, and the app.ts wiring):
```
$ bun test tests/daemon/pid-started-at.test.ts tests/server/daemon/status.test.ts
4 pass
0 fail
9 expect() calls
```

The uptime-tolerance test specifically:
```ts
const when = Date.now() - 5000;
utimesSync(path, new Date(when), new Date(when));
const res = handleDaemonStatus({ daemonPidPath: path, bindInfo });
const body = (await res.json()) as DaemonStatusDTO;
expect(body.uptimeMs).toBeGreaterThanOrEqual(4000); // ~5s, derived from mtime
```
passed — `uptimeMs` came out of the injected mtime, not `process.uptime()`
(which would report this test process's own age, unrelated to the fixture's
manufactured 5s-old pid file).

I also added one test to `tests/server/app.test.ts` (not explicitly listed in
the brief's file list, but the same pattern the brief used for Task 8's
`queue/stats` 503 test) proving the route-level behavior end-to-end through
`buildFetch`: 401 with no bearer token, then 503 with the exact
`DepUnavailableError` message when `daemonPidPath`/`bindInfo` are unwired —
confirming both "stays behind the session guard" and "missing optional deps
degrade cleanly" at the actual HTTP layer, not just at the handler-unit level.

## Gate results

- `bun run typecheck` → clean (0 errors) — confirmed existing `ServerDeps`
  fixtures (e.g. `tests/server/app.test.ts`'s `deps` object, which sets
  neither `daemonPidPath` nor `bindInfo`) still compile unedited, since both
  new fields are optional.
- `bun run lint:file -- src/daemon/pid.ts src/server/daemon/status.ts src/server/app.ts src/daemon/spans.ts tests/daemon/pid-started-at.test.ts tests/server/daemon/status.test.ts tests/server/app.test.ts`
  → clean after one `biome check --write` auto-format pass (line-wrapping/
  import-sort only, no logic changes).
- `bun test tests/server/ tests/daemon/` → 332 pass, 0 fail, 866 expect()
  calls across 73 files (full local sanity, not just the two new files).

## Files changed

- `src/daemon/pid.ts` — added `readStartedAt`.
- `src/daemon/spans.ts` — added `recordDaemonStatusRead`.
- `src/server/daemon/status.ts` — new; `handleDaemonStatus` + `DaemonStatusDeps`.
- `src/server/app.ts` — optional `daemonPidPath`/`bindInfo` on `ServerDeps`,
  import + route wiring for `GET /api/daemon/status`.
- `tests/daemon/pid-started-at.test.ts` — new.
- `tests/server/daemon/status.test.ts` — new.
- `tests/server/app.test.ts` — added the 503/401 route-level test.

`src/server/main.ts` was **not** touched — the brief itself defers real
`daemonPidPath`/`bindInfo` population there to Task 11 ("Real population in
main.ts/daemon is T11"). Confirmed `main.ts` currently sets neither field, so
`GET /api/daemon/status` will 503 in the running daemon until T11 wires it —
expected and by design (optional fields, no fixture ripple).

## Commit

`a41adeb` — `feat(server): GET /api/daemon/status uptime(from pid mtime)+bind (Slice 25b Incr 2, §7.3)`
- Files: `src/daemon/pid.ts`, `src/daemon/spans.ts`, `src/server/app.ts`, `src/server/daemon/status.ts` (new), `tests/daemon/pid-started-at.test.ts` (new), `tests/server/daemon/status.test.ts` (new), `tests/server/app.test.ts`

## Self-review

- Diff scope matches the brief's `git add` list, plus one extra test file
  (`tests/server/app.test.ts`) that follows the brief's own T8 precedent —
  not scope creep, an application of the same pattern the brief itself uses.
- Staged only the specific files above (checked via `git status --short`
  before/after `git add`); left the numerous unrelated concurrently-modified
  files (other task briefs/reports, `.remember/*`, the SDD ledger) untouched.
- No deviations from the brief's verbatim code snippets — mechanism
  (`statSync(pidPath).mtimeMs`, `need()`/`DepUnavailableError` reuse, optional
  `ServerDeps` fields) matches exactly.

## Concerns

- None blocking. `src/server/main.ts` wiring is explicitly out of scope per
  the brief (T11's job) — flagging here only so the controller doesn't
  mistake the current 503-until-T11 state for a defect.
- The brief's own sample code guards the mtime read on `pid !== undefined`
  (mirrored here) rather than reading it unconditionally — a *dead* pid whose
  file `readLivePid` just deleted never produces a stale `startedAt`/
  `uptimeMs` alongside `running: false`. Confirmed this matches the DTO's own
  doc comment ("`pid`/`startedAt`/`uptimeMs` are absent when `running` is
  false").
- No contradictions found between the brief and the real `pid.ts`/`app.ts` —
  the brief's file:line references (`readLivePid` at `pid.ts:77`, the T8
  `need()` in `app.ts`) matched the actual code exactly, so no NEEDS_CONTEXT
  stop was warranted.

## Post-review fix (§7.3 adversarial review, Important gap)

**Gap:** `uptimeMs = Date.now() - startedAt` had no floor. `startedAt` comes
from the pid-file mtime; in a proxied/split-process future the reader's
`Date.now()` and the pid-file mtime can come from different machine clocks,
so skew could make the subtraction negative. `DaemonStatusDtoSchema` types
`uptimeMs` as `z.number().optional()` (not `.nonnegative()`), so a negative
value would flow through to the client as a misreported negative uptime.

**Fix:** clamped the computation in `src/server/daemon/status.ts`:

```ts
const uptimeMs =
  startedAt !== undefined ? Math.max(0, Date.now() - startedAt) : undefined;
```

`undefined` (daemon not running) is preserved as `undefined`, never coerced
to `0` — only the defined-but-negative case is clamped.

**Test strength (Minor, also addressed):** in
`tests/server/daemon/status.test.ts`:
- Added an upper-bound assertion to the existing mtime-based uptime test —
  `expect(body.uptimeMs).toBeLessThan(60000)` — alongside the existing
  `toBeGreaterThanOrEqual(4000)`, so a regression back to
  `process.uptime()` (which would report the whole test-process age) is
  caught.
- Added a new test: pid mtime 5s in the *future* → `uptimeMs === 0` (the
  clamp).
- The absent-pid-file → `uptimeMs === undefined` case was already covered
  by the existing "not-running" test; no new test needed there.

**Gate:**
- `bun run typecheck` — clean, no errors.
- `bun run lint:file -- src/server/daemon/status.ts tests/server/daemon/status.test.ts` — clean (biome, no fixes needed).
- `bun test tests/server/daemon/status.test.ts` — 3 pass, 0 fail, 9 expect() calls.
- `bun test tests/server/ tests/daemon/` — 333 pass, 0 fail, 868 expect() calls, across 73 files.

**Scope:** touched only `src/server/daemon/status.ts` and
`tests/server/daemon/status.test.ts`. Uptime source (pid-file mtime), the
bind object, the span, and everything else in the handler are unchanged.

**Commit:** `fix(server): clamp daemon uptimeMs ≥0 for clock-skew safety (Slice 25b T9 review)`

---
---

# Slice 25 — Task 9: fire.ts convergence point + substitute.ts

**Status:** COMPLETE. Commit `20796c4`.

## What was built
- `src/triggers/substitute.ts` — `substituteTemplate(payload, vars)`: deep recursive
  walk over any JSON-shaped payload; replaces `{{key}}` (regex
  `/\{\{\s*([\w.]+)\s*\}\}/g`) in every STRING leaf with `vars[key]` when present,
  leaving unknown keys literal. Arrays/objects recursed; non-string leaves
  (number/boolean/null) pass through untouched. Structurally fresh output (no
  mutation). PLAIN string interpolation only — NO `eval`/`Function`/template engine
  (§7.3). Verified by grep: the only `eval`/`Function` tokens in the two src files
  are inside doc comments, never executable.
- `src/triggers/fire.ts` — `createFireTrigger(deps)` returning `FireTrigger`.
  Implemented the brief body verbatim inside `withTriggerFireSpan`:
  1. **Chain-depth cap** (`ctx.chainDepth ?? 0`) checked FIRST against
     `deps.maxChainDepth()` — over-cap records a `Failed` firing + span outcome and
     returns `{fired:false}` with NO enqueue. Enforced at this single convergence
     point so no `reason` can bypass it (depth==cap still fires; depth>cap fails).
  2. **Overlap protection** — `allowOverlap` = `bypassOverlap===true` OR
     (`type===Cron` && `(config as CronConfig).allowOverlap===true`). Branch is on
     `trigger.type` explicitly (T1 non-discriminated union — never structural
     narrowing). When not allowed, joins `latestFiring→jobId→getJob`; if prev job is
     Queued|Running, records `SkippedOverlap` firing + `recordTriggerSkip` span, no
     enqueue.
  3. **Fire path** — pre-mints `newRunId()` + `createRun(runsRoot,runId)` (so an
     immediate stream never 404s), `jobStore.enqueue` with
     `origin=ORIGIN_FOR[reason]`, `chainDepth=depth`, substituted payload; then
     `recordFiring(Fired)` and `update(t.id,{lastFiredAt:now})`.
  - `ORIGIN_FOR`: cron→Schedule, webhook→Webhook, file/chain/manual→Api (spec D3).
  - **M5** honored: `lastFiredAt` written ONLY on the Fired path, never skip/fail.
  - **M7** accepted-gap NOTE comment kept verbatim (firing row + enqueue span two
    bun:sqlite connections; audit-only orphan risk documented, not fixed).

Kept `FireReason` as the brief's string-literal union (not an enum) because the brief
specifies it exactly and callers pass string literals (`reason: 'cron'`); Biome does
not flag it.

## Tests (TDD — written first, verified failing, then green)
- `tests/triggers/substitute.test.ts` (5): nested-string-only substitution; unknown
  placeholder left literal; array elements + non-string leaves untouched; multiple
  placeholders + inner whitespace; code-shaped key stays literal (proves non-eval).
- `tests/triggers/fire.test.ts` (8, real TriggerStore+JobStore on a shared temp
  jobs.db): cron→Schedule + Fired firing + payload substituted + run dir created +
  lastFiredAt bumped; overlap skip on in-flight prev (audit firing still written);
  allowOverlap config lets concurrent through; terminal prev does not block;
  chain-depth cap → Failed + no enqueue + audit firing; at-cap boundary still
  enqueues with its chainDepth + origin=Api; bypassOverlap manual fire ignores
  in-flight; webhook→Webhook.

## Gate
- `bun run typecheck` — clean (fixed a `noUncheckedIndexedAccess` narrowing in
  substitute's replacer by binding `vars[key]` to a const before the undefined check).
- `bun run lint:file` on all four files — clean.
- `bun run test:file -- tests/triggers/` — 32 pass / 0 fail (13 new + existing
  store/spans/migrations/types).
- pre-commit docs-check passed (src/triggers already a documented subsystem).

## Concerns
- None blocking. M7 orphan-audit gap is the one accepted limitation (documented in
  code per brief). Downstream tasks (scheduler/watcher/webhook/chain) must pass
  `chainDepth = finishedJob.chainDepth + 1` on chain hops for the cap to bite.

## Fix pass

Post-spec-review defect pass: two reviewers found four real defects (verified,
implemented as specified — not re-litigated). All four fixed in one commit.

### FIX 1 (Important) — overlap masked by skip rows
- **Where:** `src/triggers/store.ts` (new `latestFiredFiring`), `src/triggers/fire.ts` (overlap check).
- **What:** `latestFiring` returns the most-recent firing regardless of outcome;
  a skip/fail row has jobId=null, so on the NEXT tick the guard saw a jobId-less
  row and fell through → concurrent enqueue on the 3rd tick. Added
  `latestFiredFiring(triggerId)` (`WHERE job_id IS NOT NULL`, mirroring
  latestFiring's shape) and switched the overlap check to use it.
- **Test:** `overlap guard: a skip row does not mask the still-in-flight fired job
  (3-fire regression)` — every-tick cron, job A claimed→Running; fire1 Fired,
  fire2 SkippedOverlap, fire3 must ALSO be SkippedOverlap (would breach pre-fix).

### FIX 2 (F2) — overlap TOCTOU
- **Where:** `src/triggers/fire.ts`.
- **What:** `await createRun` sat between the sync overlap check and the sync
  enqueue, so two concurrent fires both passed the check during each other's
  await. Reordered so check→enqueue→recordFiring→update is one yield-free sync
  block (bun:sqlite is sync); `await createRun(runId)` now runs AFTER the block
  (run dir still exists before fireTrigger returns; markJobOrigin's create is
  idempotent).
- **Test:** `two concurrent fires on a non-allowOverlap trigger yield exactly one
  Fired + one SkippedOverlap` (Promise.all; deterministic under the reorder; also
  asserts exactly one job enqueued).

### FIX 3 (N1) — prototype-chain template lookup
- **Where:** `src/triggers/substitute.ts` (`substituteString`).
- **What:** `vars[key]` walked the prototype chain, so `{{toString}}` /
  `{{constructor}}` interpolated function sources instead of staying literal.
  Guarded with `Object.hasOwn(vars, key)` (unknown → placeholder left literal).
- **Test:** extended the unknown-placeholder test — `{{toString}}`,
  `{{constructor}}`, `{{__proto__}}` all stay literal.

### FIX 4 (N2) — chainDepth clamp
- **Where:** `src/triggers/fire.ts` (depth guard + `ctx.chainDepth` doc comment).
- **What:** `depth > maxChainDepth()` let NaN/negative through (NaN self-
  perpetuates through +1 hops → unbounded chains). Now a supplied
  `ctx.chainDepth` that is not a non-negative integer is treated as cap-exceeded
  (same Failed outcome — plan-mandated, unchanged — no enqueue). Added the
  trust-boundary doc comment on `ctx.chainDepth` (callers MUST derive from the
  source job's persisted chainDepth +1 per hop; caller-side enforcement = T13/T24).
- **Test:** `chainDepth clamp: NaN is rejected as cap-exceeded` and `... a negative
  depth is rejected as cap-exceeded` — both assert Failed + no enqueue.

### Gate
- `bun run typecheck` — clean.
- `bun run lint:file -- src/triggers/fire.ts src/triggers/store.ts src/triggers/substitute.ts tests/triggers/` — clean (9 files, no fixes).
- `bun run test:file -- tests/triggers/` — **36 pass / 0 fail** (109 expect calls; +4 new regression tests over the prior 32).
- M7 NOTE untouched; over-cap outcome value (Failed) unchanged, per brief.

## Fix pass 2

Re-review found a pre-existing latent ordering bug in `src/triggers/store.ts`: firing
ids are `newId('f', now, rand)` (random suffix per ms), but `latestFiring` /
`latestFiredFiring` / `listFirings` ordered by `fired_at DESC, id ASC`. Two firings in
the same millisecond sorted in random id order, so "latest" occasionally returned the
OLDER row — the `overlap skip when the previous job is still running` test failed ~25%
of runs when the Fired and SkippedOverlap firings shared a millisecond.

### Root cause fix — monotonic rowid tiebreak
- `latestFiring` + `latestFiredFiring`: `ORDER BY fired_at DESC, rowid DESC` (newest
  insertion wins ties).
- `listFirings` keyset reworked from (fired_at, id / `id ASC`) to (fired_at, rowid):
  `SELECT rowid, *`, cursor now encodes `fired_at:rowid`, WHERE clause
  `fired_at < ? OR (fired_at = ? AND rowid < ?)`, `ORDER BY fired_at DESC, rowid DESC`
  — strictly monotonic, no gaps/overlaps under ties. Cursor stays opaque (same
  base64url encode/decode helpers); `TriggerFiring` DTO does NOT gain a rowid field
  (rowid is internal to the cursor only).

### Comment nits
- NIT 1: fire.ts run-dir comment `markJobOrigin` → `markDaemonOrigin` (real fn in
  `src/server/jobs/dispatch.ts`).
- NIT 2: extended the M7 NOTE — after the F2 reorder, if `createRun` throws post-enqueue
  the job is durably enqueued + Fired recorded but fire() throws; same audit-gap family
  as M7, accepted.

### Tests
- Existing keyset page-2 test still passes.
- ADDED `same-millisecond firings resolve deterministically by insertion order (rowid
  tiebreak)`: records 5 firings with an identical `fired_at`, asserts latestFiring /
  latestFiredFiring return the LAST-inserted row and that size-2 keyset pagination over
  the tied rows is stable + complete (newest-insertion→oldest, no gap/overlap) — wrapped
  in a 20-iteration loop to prove determinism.

### Gate
- `bun run typecheck` — clean.
- `bun run lint:file -- src/triggers/store.ts src/triggers/fire.ts tests/triggers/store.test.ts tests/triggers/fire.test.ts` — clean (no fixes).
- `bun run test:file -- tests/triggers/` — **37 pass / 0 fail** (189 expect calls; +1 new determinism test).
- Previously-flaky loop: `for i in {1..20}; do bun test tests/triggers/fire.test.ts -t "overlap skip"; done` → **PASSED 20/20**.

---
---

# Slice 31 — Task 9: `src/a2a/server.ts` + `src/a2a/task-index.ts` (A2A JSON-RPC dispatch, §7.2 + §7.4)

**Status: COMPLETE.** Commit `708d58c` — `feat(a2a): JSON-RPC server (message/send→enqueue, tasks/get, tasks/cancel)` on `slice-31-a2a-multimachine`.

## Implemented

- **`src/a2a/task-index.ts`** — `createTaskIndex()` → `{ taskIdForJob, jobIdForTask, contextFor, bind }`. taskId IS the jobId (1:1); durable identity needs no map. A tiny in-memory bidirectional map caches `taskId → jobId` + `contextId`; `jobIdForTask`/`contextFor` fall back to the durable identity (taskId itself) when the cache is cold post-restart, so identity survives a restart without persistence.
- **`src/a2a/server.ts`** — `A2aServerDeps`, `A2aRpcResult`, `handleMessageSend`, `handleTasksGet`, `handleTasksCancel`, `dispatchA2aRpc`. Mirrors `handleJobEnqueue`'s pre-mint-runId + `createRun` + `jobStore.enqueue` shape. Per-kind payload: Chat→`{task}`, Crew/Workflow→`{name: ref, input}`, plus `a2aRef` (dispatch's zod schemas strip the extra key).
- **`src/server/chat/task.ts`** (refactor) — extracted the fenced delimited-untrusted primitive into exported `delimitUntrusted(preamble, text)`, reused by both `buildTaskFromMessages` (byte-identical output — existing chat-task tests green) and the A2A server. `buildTaskFromMessages` can't be reused directly for a single inbound A2A message: it leaves the *latest* user turn unfenced (correct for local chat, wrong for a fully-untrusted remote peer).

## TDD RED → GREEN

- **RED**: moved both impl files aside → `bun test tests/a2a/server.test.ts` → `error: Cannot find module '../../src/a2a/server.ts'`, `0 pass 1 fail`. Restored.
- **GREEN**: `bun test tests/a2a/server.test.ts tests/server/chat-task.test.ts` → `11 pass 0 fail, 37 expect()`.
- 7 cases (6 brief + artifactId stability): listed-skill enqueue origin=Remote + Submitted + taskId===jobId; unlisted→-32004, enqueue spy NOT called; inbound parts fenced-untrusted (injected bare `TRANSCRIPT` neutralized → exactly 1 closing fence line); tasks/get Running→working; tasks/cancel→canceled (markCanceled fired); unknown method→-32601; two tasks/get on the same Done job return the SAME `job-done-1-artifact-0`.

## Gate

- `bun run typecheck` → clean.
- `bun run lint:file -- src/a2a/server.ts src/a2a/task-index.ts src/server/chat/task.ts tests/a2a/server.test.ts` → exit 0, no warnings (removed `!` non-null assertions via a `req()` helper to match repo test convention).
- `tests/a2a/` + `tests/server/chat-task.test.ts` → 32 pass. Full `tests/server` → 455 pass / 1 fail: `sse-reconcile.integration.test.ts` "late subscriber…", passes 3/3 in isolation — a pre-existing SSE-timing flake under full-suite concurrency, unreachable from a pure string builder + new A2A files.

## Security self-check

- **§7.4 resolve-then-reject BEFORE enqueue**: `deps.allowlist.resolve(skillId)` is the FIRST thing inside the span; `undefined` → `fail(-32004)` returned before `newRunId`/`createRun`/`enqueue`. NO fall-through — the only path to `enqueue` is a resolved target (test asserts enqueue spy length 0 on the unlisted path). Defense-in-depth: `buildJobPayload` returns undefined for any non-{Chat,Crew,Workflow} kind → also rejects pre-enqueue (a Pull/Build can never enqueue via A2A even under a tampered allowlist).
- **§7.2 untrusted inbound content**: inbound text → `untrustedInboundText` → `delimitUntrusted` (neutralizeFence + `<<<TRANSCRIPT … TRANSCRIPT` fence). Never spliced as an instruction; embedded fence-closing lines neutralized (test proves exactly one bare closing line survives; text is not a leading instruction).
- **taskId↔jobId identity across get/cancel**: `bind(job.id, job.id, contextId)`; get + cancel resolve `jobIdForTask(taskId)` (identity) → `getJob`, return `id: taskId`. 1:1 holds.
- **artifactId stability**: `projectArtifacts` derives `${taskId}-artifact-0`, overriding `task-map`'s per-call `randomUUID()` → stable across polls (test-verified).

## Notes / deviations

- **`A2aServerDeps.pool?` (additive, optional)** — NOT in the brief's Produces block. The fixed deps had only `jobStore`, but a truly RUNNING job needs the pool's per-job AbortController to abort in-flight work (mirrors `server/jobs/cancel.ts`). Added OPTIONAL: present → `pool.cancel(id)` for a Running job; absent (unit tests, queued/terminal) → `jobStore.markCanceled(id)`. Task 12 wires the real pool. Backward-compatible with the declared shape.
- **Error-code overlap `-32001`** — used here for A2A `TaskNotFoundError` (top-level RPC error on get/cancel of an unknown task). `task-map.ts` also defines `-32001` = `MISSING_CAPABILITY`, but that rides a *completed-but-failed task's terminal error field*, never the top-level RPC position — documented in-code. `-32004` "skill not allowed" aligns with A2A's `UnsupportedOperationError`.
- **`createRun` API** matched the brief (`createRun(runsRoot, id)` in `src/run/run-store.ts`) — no deviation.
- Persisted payload carries `a2aRef`; dispatch's per-kind zod schemas strip it (unknown-key strip) — inert provenance, not consumed by dispatch.
