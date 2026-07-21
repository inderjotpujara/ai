# Task 10 report — `GET /api/daemon/logs` redacted tail (Slice 25b Incr 2, §7.3)

## Status: DONE — gate green, commit landed.

## Commit
`07930d5` — `feat(server): GET /api/daemon/logs redacted tail (Slice 25b Incr 2, §7.3)`

Files: `src/server/daemon/redact.ts` (new), `src/server/daemon/logs.ts` (new),
`src/server/app.ts` (modified — route + optional `daemonLogDir`),
`src/daemon/spans.ts` (modified — `recordDaemonLogsRead`),
`tests/server/daemon/redact.test.ts` (new), `tests/server/daemon/logs.test.ts` (new).

Only these six files were `git add`-ed (not `-A`) — pre-existing unrelated
working-tree modifications under `.superpowers/sdd/*.md` and `.remember/*`
(session-continuity files from earlier/other work) were left untouched and
uncommitted, as instructed.

## Implementation

### `redactSecrets` (`src/server/daemon/redact.ts`)
```ts
const REDACTED = '‹redacted›';
export function redactSecrets(line: string): string {
  return line
    .replace(/\b[0-9a-f]{64}\b/gi, REDACTED)
    .replace(/Bearer\s+\S+/g, `Bearer ${REDACTED}`);
}
```
- `/\b[0-9a-f]{64}\b/gi` — global (`g`) + case-insensitive (`i`), word-boundary
  anchored so it matches only a full 64-hex run (the exact root-token /
  session-sig shape), not a hex substring inside a longer token. Runs FIRST.
- `/Bearer\s+\S+/g` — global, runs SECOND so a `Bearer <64hex>` line has its
  hex collapsed by the first pass, and the second pass still matches the
  now-`Bearer ‹redacted›` text and re-collapses it idempotently (verified by
  a test: "redacts a 64-hex token even when it trails a Bearer prefix" →
  `Bearer ‹redacted›`, no double-marker). A `Bearer eyJ....payload.sig`
  (non-hex, JWT-shaped) is caught by the second pass alone.
- Both regexes are confirmed GLOBAL by an added test with TWO distinct
  64-hex tokens on one line — both are redacted (`‹redacted›` appears twice),
  not just the first occurrence.

### `handleDaemonLogs` (`src/server/daemon/logs.ts`)
Flow, in order:
1. Parse/validate `tail`/`stream` via `DaemonLogsQuerySchema.parse` (coerces
   `tail`, caps at 2000, defaults `stream: 'out'`) — a `ZodError` → 400 before
   any file I/O happens.
2. `readFileSync(join(daemonLogDir, `agent.${stream}.log`), 'utf8')` — reads
   the file, splits on `\n`, filters empty lines.
3. **`.slice(-query.tail).map(redactSecrets)`** — the redaction pass (`.map`)
   runs on the sliced tail BEFORE `DaemonLogsResponseSchema.parse({ lines })`
   builds the response body and BEFORE `json(...)` constructs the `Response`.
   No code path serializes the raw `readFileSync` string or the unredacted
   `all` array into a `Response` — only the redacted `lines` array ever
   reaches `JSON.stringify`. **This is the before-bytes-leave proof**:
   redaction is a synchronous step strictly between "read from disk" and
   "construct the Response," with no branch that skips it.
4. Any read failure (ENOENT, EACCES, is-a-directory, etc.) is caught and
   collapses to `lines = []` — never a 500, never a partial/raw read leaking
   through an exception path.
5. `recordDaemonLogsRead()` emits the `daemon.logs.read` span (no-op span
   when no tracer provider is registered — same convention as
   `recordDaemonStatusRead`/`recordQueueStatsRead`).
6. `DaemonLogsResponseSchema.parse({ lines })` validates the shape before
   `json(..., 200)` returns it.

### Tail-read mechanism (per the brief — flagged as a concern below)
The brief's Step 5 code — which I followed verbatim, since the brief
explicitly supplies the exact implementation and this is not the
log-dir-derivation ambiguity the STOP condition covers — uses
**read-whole-file-then-slice-last-N** (`readFileSync` the entire file,
`split('\n')`, `.slice(-tail)`), not a true tail-seek/reverse-read. The
unboundedness protection is that the *response* size is capped (`tail` ≤
2000 lines via the schema), not that disk/memory I/O is bounded for a huge
log file. See Concerns.

### Empty/missing-file handling
`readFileSync` throwing (file absent, dir absent, unreadable) is caught by
the surrounding `try/catch`, reducing to `lines = []`, then still returns a
normal `200` with `{ lines: [] }` — never a `500`. Verified by the "missing
log file yields an empty lines array" test using a nonexistent temp directory.

### Span helper (`src/daemon/spans.ts`)
```ts
export function recordDaemonLogsRead(): void {
  const span = tracer().startSpan('daemon.logs.read');
  span.end();
}
```
Matches the existing `recordDaemonStatusRead`/`recordQueueStatsRead` idiom
exactly — no parallel span-emission path.

### Route wiring (`src/server/app.ts`)
- Added `daemonLogDir?: string` to `ServerDeps` (optional, same rationale/
  comment style as `daemonPidPath`/`queueConcurrency` from T8/T9 — legacy
  fixtures need not set it; the route degrades to 503 via `need()`).
- Added the route inside `handleApi`'s existing try/catch ladder (behind the
  session guard upstream in `buildFetch`, same as every other `/api/*`
  route), reusing the exported `need()`/`DepUnavailableError` from `app.ts`
  itself (T8) — not redefined:
```ts
if (req.method === 'GET' && url.pathname === '/api/daemon/logs') {
  const res = handleDaemonLogs(new URLSearchParams(url.search), {
    daemonLogDir: need(deps.daemonLogDir, 'daemonLogDir'),
  });
  rec.status(res.status);
  return res;
}
```
- `src/server/main.ts` was NOT modified — `daemonLogDir` (like
  `daemonPidPath`/`bindInfo` from T9) is not yet populated in the real deps
  object there; that wiring is explicitly deferred to T11 per the brief
  (`join(dirname(defaultPidPath()), 'logs')`, matching
  `src/cli/daemon.ts`'s `defaultLogDir()` = `join(defaultPidPath(), '..', 'logs')`
  — the same directory, equivalent path expression). No typecheck error
  results since the field is optional.

## TDD RED → GREEN

**RED (`redact.test.ts`, before `redact.ts` existed):**
```
error: Cannot find module '../../../src/server/daemon/redact.ts'
0 pass / 1 fail / 1 error
```

**GREEN (`redact.test.ts`, 5 tests — 3 from the brief + 2 I added for the
global-regex and Bearer+hex-overlap guarantees):**
```
5 pass
0 fail
10 expect() calls
```

**RED (`logs.test.ts`, before `logs.ts` existed):**
```
error: Cannot find module '../../../src/server/daemon/logs.ts'
0 pass / 1 fail / 1 error
```

**GREEN (`logs.test.ts` + `redact.test.ts` together, 10 tests — 4+3 from the
brief, plus 1 extra redaction-marker assertion and 2 extra redact edge cases
I added):**
```
10 pass
0 fail
17 expect() calls
```
Key secret-not-leaked assertion (the brief's own mandatory test, confirmed
passing): a temp `agent.out.log` seeded with `Bearer eyJ.payload.sig` and a
64-`b` hex token — `body.lines.join('\n')` asserted to `not.toContain(hex)`
and `not.toContain('eyJ.payload.sig')`, and separately asserted to
`toContain('‹redacted›')`.

## Gate results
- `bun run typecheck` → clean (0 errors) after one fix: the test file's
  `res.json()` returns `unknown` under strict TS, so I typed it via
  `import type { DaemonLogsResponse } from '../../../src/contracts/index.ts'`
  and `(await res.json()) as DaemonLogsResponse`, matching the existing
  `status.test.ts` pattern (`as DaemonStatusDTO`). Test-only annotation, no
  behavior change.
- `bun run lint:file -- src/server/daemon/redact.ts src/server/daemon/logs.ts src/server/app.ts src/daemon/spans.ts tests/server/daemon/redact.test.ts tests/server/daemon/logs.test.ts`
  → 1 formatting nit on the first run (biome wanted the multi-symbol import
  and the `json()` headers object literal in `logs.ts` each expanded to
  multi-line); reformatted to match and reran → clean, 0 errors.
- `bun test tests/server/` → **316 pass, 0 fail, 798 expect() calls** across
  69 files (full existing server suite unaffected).

## Concerns
1. **Tail-read is read-whole-then-slice, not a bounded/seeking tail read.**
   The brief's own Step 5 code (which its acceptance criteria and Step 8
   gate both validate against) reads the entire log file into a string via
   `readFileSync` before slicing to the last `tail` lines. The response is
   bounded (≤2000 lines, enforced by the schema), but disk/memory I/O for a
   pathologically large log file is NOT bounded by this implementation —
   e.g. a multi-GB `agent.out.log` would be read entirely into memory
   before slicing. This is a memory/DoS-adjacent concern, distinct from
   §7.3's stated hazard (token exfiltration over HTTP), which this
   implementation fully addresses. I followed the brief verbatim per
   instructions, since it explicitly specified this exact mechanism and
   code, and the task brief's own framing ("tail-read, or read-then-slice-
   last-N — the brief specifies which") signals this trade-off was already
   decided upstream. Flagging for the controller/reviewer to confirm
   whether a real bounded tail-seek (e.g. reading only the last N KB, or
   shelling out to `tail -n` the way the CLI's own `logs` subcommand uses
   `tail -f`) should be added before this ships broadly, or whether it's an
   accepted trade-off given expected/rotated log sizes in this framework.
2. **`daemonLogDir` is not yet wired in `main.ts`** — by design, deferred to
   T11 per the brief. Until T11 lands, hitting `/api/daemon/logs` on a real
   running server returns a clean `503 { error: 'server dependency not
   configured: daemonLogDir' }`, never a crash — confirmed consistent with
   the T8/T9 precedent (`daemonPidPath`/`bindInfo`/`queueConcurrency` are
   similarly still unwired in `main.ts` pending their own follow-on tasks).
3. No behavior change to any other route; `src/server/main.ts` was lint-
   checked (per the brief's Step 9 command) but not modified — it was
   already lint-clean.

## Files changed
- `src/server/daemon/redact.ts` (new)
- `src/server/daemon/logs.ts` (new)
- `src/server/app.ts` (modified)
- `src/daemon/spans.ts` (modified)
- `tests/server/daemon/redact.test.ts` (new)
- `tests/server/daemon/logs.test.ts` (new)

---

## §7.3 hardening fix-up — post-review (2026-07-20)

An adversarial §7.3 review of this task's redaction/read implementation
found three real gaps with concrete leak/DoS inputs. All three are fixed.

### Fix 1 (Important) — hex redaction missed glued/embedded secrets
`redactSecrets`'s hex pattern was `/\b[0-9a-f]{64}\b/gi`. The `\b` anchors
fail whenever the 64-hex secret sits adjacent to a word char (letter/
digit/underscore) — an 80-hex run, `key<64hex>z`, and `zkey_<64hex>` all
leaked. Fixed to **`/[0-9a-f]{64,}/gi`** (no `\b`, `{64,}` swallows the
whole hex run so a longer embedded run is fully redacted, not partially
matched). Over-redaction is the correct fail-closed tradeoff for a
security scrubber.

### Fix 2 (Important) — Bearer redaction was case-sensitive
The Bearer pattern was `/Bearer\s+\S+/g` (no `i`). RFC 7235 makes the auth
scheme case-insensitive and loggers commonly lowercase headers, so a
lowercase `authorization: bearer <token>` line leaked its opaque token.
Fixed to **`/Bearer\s+\S+/gi`**.

### Fix 3 (Important) — unbounded whole-file read (DoS on the always-on daemon)
`logs.ts` did `readFileSync(wholeFile)` then sliced the last N lines. The
daemon's log is rotation-less and always-on, so it grows unbounded; a
multi-GB file would block the event loop / OOM the very process hosting
the web UI. Replaced with a **bounded tail read** (`readTailLines` in
`src/server/daemon/logs.ts`): `statSync` for file size, then
`openSync`/`readSync` to pull only the last `min(size, TAIL_READ_CAP_BYTES)`
bytes (`TAIL_READ_CAP_BYTES = 1 MiB`, comfortably covering the schema's
2000-line cap). If the file exceeds the cap, the possibly-partial first
line of the read chunk is dropped before taking the last `tail` lines.
Response shape and the redact-before-bytes-leave ordering are unchanged;
a missing/empty file still yields `lines: []`.

### Regression tests added (reviewer's exact leak inputs)
`tests/server/daemon/redact.test.ts` — new cases assert the secret
substring is ABSENT for: an 80-hex run containing a 64-hex secret,
`key<64hex>z`, `zkey_<64hex>`, and lowercase `bearer <opaque-token>`.

`tests/server/daemon/logs.test.ts` — new case writes a ~2 MiB log file
(10,000 padded lines, well past the 1 MiB read cap) and asserts the
bounded reader still returns the exact correct last-3 lines.

### Verification
- `bun run typecheck` — clean (`tsc --noEmit`, no errors).
- `bun run lint:file -- "src/server/daemon/redact.ts" "src/server/daemon/logs.ts" "tests/server/daemon/redact.test.ts" "tests/server/daemon/logs.test.ts"` — `Checked 4 files. No fixes applied.`
- `bun test tests/server/daemon/redact.test.ts tests/server/daemon/logs.test.ts` — **15 pass, 0 fail, 22 expect() calls** (previously-leaking reviewer inputs now confirmed redacted).
- `bun test tests/server/` (full sanity) — **321 pass, 0 fail, 803 expect() calls**.

### Commit
`f258c25` — `fix(server): harden daemon-logs redaction (embedded-hex + case-insensitive Bearer) + bounded tail read (Slice 25b T10 §7.3 review)`

Files: `src/server/daemon/redact.ts`, `src/server/daemon/logs.ts`,
`tests/server/daemon/redact.test.ts`, `tests/server/daemon/logs.test.ts`
(only these four `git add`-ed; unrelated pre-existing working-tree
modifications left untouched).

---

# Task 10 report — scheduler.ts + next-run.ts (Slice 25 Triggers, §7.2, HARD)

## Status: DONE — gate green, commit landed.

## Commit
- `e243303` — feat(triggers): poll-tick scheduler + Croner next-run + fire-once misfire

## Files
- Created `src/triggers/next-run.ts` — `validateCron(schedule, tz?)` (construction-only pattern check) + `computeNextRun(t, after)` (Croner `new Cron(pattern,{timezone}).nextRun(after)?.getTime() ?? null`, whole expression wrapped in try/catch → null on ANY throw).
- Created `src/triggers/scheduler.ts` — `createScheduler(deps)` → `{ start, stop, tick, reconcile }`. Injectable `now`/`setInterval`/`clearInterval` seams; `createLogger('triggers.scheduler')` for structured logs.
- Created `tests/triggers/next-run.test.ts` (6 tests), `tests/triggers/scheduler.test.ts` (9 tests).
- `bun add croner` → croner@10.0.1 (first consumer); package.json + bun.lock staged.

## Test summary
- 14 focused tests pass (30 assertions); full `tests/triggers/` suite 51 pass / 0 fail.

## Contracts honored
- **I1**: `computeNextRun` never throws — malformed pattern (throws at construction) AND bad IANA zone (throws at `.nextRun()`, verified against croner@10.0.1) both caught → null. `reconcile()` disables (never throws on) a row whose compute is null; the "daemon boot survives a bad repo cron" test asserts `enabled === false` after reconcile with no throw.
- **T7 liveness**: `tick()` wraps `claimDueCron` in try/catch — a throw (incl. SQLITE_BUSY) is logged+counted (`tickErrors`) and the loop keeps ticking; interval stays armed. Test: a store whose `claimDueCron` throws once → first tick no-throw/no-fire, next tick fires normally.
- **Misfire = at-most-once fire-once-on-boot**: reconcile leaves a past `next_run_at` in place (default catchUp) so the FIRST tick claims it exactly once, then `claimDueCron` advances to the next future occurrence — never one-per-missed-interval. `catchUp:false` advances straight to the future with no boot fire. Full matrix tested (fresh/past+catchUp/past+catchUp:false/future). No "exactly once" wording used anywhere (crash-between-claim-and-enqueue documented as the at-most-once gap).
- Fire is fire-and-forget: `void deps.fire(t,{reason:'cron'}).catch(...)` — logs+counts (`fireErrors`), never an unhandledRejection.
- `start()` runs `reconcile()` BEFORE arming the interval (verified: fake setInterval, callback not auto-invoked, reconcile-then-tick ordering asserted).
- Croner is library-only (compute next occurrence); no Croner-managed timers.

## Concerns
- None blocking. `AGENT_TRIGGERS_POLL_MS` (schema default 1000) is the intended `pollMs` source but is wired by the daemon caller (Increment 3 / daemon integration), not this task — scheduler takes `pollMs` as an injected number per the brief signature.
- `tickErrors`/`fireErrors` counters are internal (logged only) — the brief's return signature is `{start,stop,tick,reconcile}` with no metrics accessor, so I kept them as closure state rather than widening the public type.

---

## Fix pass — Task 10 dual-review findings (2026-07-20)

Five verified findings from Task 10's dual review on `scheduler.ts`/
`scheduler.test.ts`, all fixed in one commit.

### Fix 1 — `start()` idempotency (timer leak, empirically confirmed)
Added a guard: `if (interval !== undefined) return;` at the top of `start()`.
A double-`start()` previously called `set(() => tick(), pollMs)` a second
time without clearing the first handle — leaking the first timer (it kept
firing, uncleared and unreachable) while running two live loops. Now a
repeat `start()` is a no-op.

Test added: `'start() is idempotent — a double-start arms only ONE interval'`
— calls `start()` three times against a fake `setInterval`/`clearInterval`
that count invocations; asserts exactly one timer was ever armed
(`armed === 1`, `intervalCbs.length === 1`), then `stop()` clears it once
(`cleared === 1`).

### Fix 2 — `reconcile()` liveness guard (asymmetric with tick's T7 contract)
`tick()` already had a T7 liveness contract: a throw from `claimDueCron`
is logged+counted and swallowed so the interval stays armed. `reconcile()`
had no equivalent — a throw from a single row's `store.update` (e.g.
`SQLITE_IOERR` on one bad row) would abort the whole boot-reconciliation
loop, leaving every trigger AFTER the throwing row unseeded/uncaught-up.
Wrapped the per-trigger body of the loop in try/catch: on a throw, log +
increment a new `reconcileErrors` counter (same pattern as `tickErrors`/
`fireErrors`) + `continue` to the next trigger. The outer `triggerStore.list()`
call itself is deliberately left UNGUARDED — a dead DB should still fail
boot fast, not silently reconcile zero triggers.

Tests added:
- `'reconcile per-row liveness guard — one throwing row does not abort seeding the rest'`
  — 3 fresh triggers, a wrapped store whose `update` throws only for the 2nd
  trigger's id; asserts the 1st and 3rd still get seeded (`nextRunAt` set),
  the 2nd (which always throws) is left unseeded, and `reconcile()` itself
  never throws.
- `'reconcile does not guard the initial store.list() call — a dead DB still fails boot fast'`
  — a wrapped store whose `list()` throws; asserts `reconcile()` propagates
  that throw (confirms the boundary of the guard is exactly where the
  finding specified, not wider).

### Fix 3 — wording nit (scheduler.ts:17)
"claims it exactly once" → "claims it a single time" — the file's own
header comment (lines 20–21) explicitly forbids describing the misfire
guarantee as "exactly once" (crash-between-claim-and-enqueue can drop the
catch-up; the real guarantee is at-most-once). Line 17 violated its own
constraint; reworded to sidestep the banned phrase while keeping the same
meaning. Confirmed via `grep -n "exactly once" src/triggers/scheduler.ts`
now returns no hits.

### Fix 4 — dropped filler test + unused import
Removed `'the outcome enum is available for reason mapping sanity'` (a
tautological assertion, `TriggerOutcome.Fired === 'fired'`, that exercised
no scheduler behavior) and the now-unused `TriggerOutcome` import from
`tests/triggers/scheduler.test.ts`.

### Fix 5 — double-`stop()` idempotency test
`stop()` already guarded (`if (interval !== undefined)`), so behavior was
already correct — this closes the test gap. Added
`'stop() is idempotent — double-stop does not throw and clears the interval once'`:
calls `stop()` twice in a row, asserts no throw and that the fake
`clearInterval` was invoked exactly once (the second `stop()` is a true
no-op, not a second clear call).

### Gate results
- `bun run typecheck` — clean (0 errors).
- `bun run lint:file -- src/triggers/scheduler.ts tests/triggers/scheduler.test.ts`
  — `Checked 2 files. No fixes applied.`
- `bun run test:file -- tests/triggers/` — **54 pass, 0 fail, 228 expect() calls**
  across 8 files (up from 51 pass pre-fix; net +3 tests after dropping 1
  filler and adding 4 — `start()` idempotency, `stop()` idempotency,
  reconcile per-row guard, reconcile list()-not-guarded).

### Commit
`cec8918` — `fix(triggers): scheduler start idempotency + reconcile per-row liveness guard + nits`

Files: `src/triggers/scheduler.ts`, `tests/triggers/scheduler.test.ts`
(only these two `git add`-ed; unrelated pre-existing working-tree
modifications under `.remember/*` and `.superpowers/sdd/*.md` left
untouched).
