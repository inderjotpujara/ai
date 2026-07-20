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
