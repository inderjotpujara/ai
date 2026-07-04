### Task 19: sqlite read-only gate — allow `WITH…SELECT` CTEs

**Status:** Done.

**Problem:** `src/mcp/sqlite-server.ts`'s `query` tool gated read-only access with
`/^select\b/i.test(trimmed)`, which false-rejected legitimate read-only CTEs
(`WITH x AS (SELECT 1) SELECT * FROM x`) — a logged Slice-15 review finding.

**Fix:** Added `isReadOnlyQuery(sql)`:
- Bare `SELECT …` → read-only (unchanged fast path).
- `WITH …` → resolve past the CTE definitions to the query's real leading
  statement keyword and require it to be `select`. Implementation:
  1. `stripParenGroups(sql)` collapses every balanced `(...)` group (CTE
     bodies, column lists) to a single space via simple depth tracking (no
     SQL grammar parsing), leaving only the top-level skeleton, e.g.
     `WITH x AS  SELECT * FROM x` or `WITH x AS  DELETE FROM t`.
  2. Tokenize the skeleton, walk `name AS [, name AS ]...` CTE headers, and
     read the token immediately after the last CTE — that's the main
     statement's keyword.
  3. Return `true` only if that keyword is `select`. Any malformed/unexpected
     shape (missing `AS`, no CTE name, etc.) returns `false` — degrade to
     reject, never widen the hole.
- Everything else (`INSERT`/`UPDATE`/`DELETE`/`DROP`/`CREATE`/`ALTER`/
  `REPLACE`/`PRAGMA`(write)/etc., including `WITH … INSERT|UPDATE|DELETE …`
  data-modifying CTEs) is still rejected — no new bare-keyword allowances were
  added beyond `select`.

Also updated the `query` tool's description/error text to mention that
read-only `WITH…SELECT` CTEs are accepted (previously said "Only SELECT
statements").

**Files changed:**
- `src/mcp/sqlite-server.ts` — added `stripParenGroups`, `isReadOnlyQuery`;
  swapped the gate check and description text.
- `tests/mcp/sqlite-server.test.ts` — extended the existing subprocess
  round-trip test with:
  - `WITH x AS (SELECT 1 AS n) SELECT * FROM x` → allowed, returns rows.
  - `WITH x AS (SELECT 1) DELETE FROM notes` → rejected (`isError: true`),
    row count unaffected (confirms the CTE-wrapped DELETE never executed).

**TDD:** Confirmed RED first — `bun run test:file -- "tests/mcp/sqlite-server.test.ts"`
failed at the new CTE-allowed assertion (`cte.isError` was `true`) against the
old SELECT-only gate. After the fix, GREEN — both tests pass, 17 `expect()`
calls, 0 fail.

**Verification (inline only, full suite intentionally not run):**
- `bun run typecheck` → 0 errors (`tsc --noEmit` clean).
- `bun run lint:file -- "src/mcp/sqlite-server.ts" "tests/mcp/sqlite-server.test.ts"` →
  clean, no fixes needed.
- `bun run test:file -- "tests/mcp/sqlite-server.test.ts"` → 2 pass, 0 fail,
  17 expect() calls.

**Concerns / notes:**
- The parser is intentionally minimal (paren-depth skeleton walk, not a real
  SQL grammar) — conservative by construction (rejects on any header shape it
  doesn't recognize, e.g. missing `AS`). This matches the brief's "when in
  doubt, reject" instruction and doesn't attempt to handle exotic-but-valid
  SQLite CTE syntax (e.g. `MATERIALIZED`/`NOT MATERIALIZED` hints between name
  and `AS`) — those would currently be rejected rather than allowed, which is
  safe but slightly stricter than SQLite's own grammar. Not in scope per the
  brief's four required cases, all of which pass.
- No new dependencies; kept to the existing regex/keyword-check style.
- Did not touch `execute`/`schema` tools or any multi-statement-injection
  guard — none existed before this change, so none was removed or added.

**Commit:** to be created after this report —
`fix(mcp): allow read-only WITH…SELECT CTEs in sqlite gate (still reject data-modifying CTEs)`

## Critical fix (engine-enforced read-only)

**Finding (CRITICAL, live-verified):** the `isReadOnlyQuery`/`stripParenGroups`
textual classifier added above is bypassable. `stripParenGroups` counts
`(`/`)` with no string-literal awareness, so a string literal that itself
contains `)`/`(` characters fools the paren-depth walk into believing a
data-modifying statement is nested inside a CTE body. Confirmed payload:

```sql
WITH x AS (SELECT ')select(' AS s) DELETE FROM t
```

classified as read-only by the old gate, and the `query` tool actually
executed the `DELETE` (rows 2 → 0). The same shape bypasses `INSERT`/
`UPDATE`/`DROP`. This defeats the `query` tool's advertised "read-only-only"
contract.

**Root cause:** parsing SQL with a hand-rolled scanner instead of asking the
engine. Any textual classifier that doesn't fully implement SQLite's string/
identifier-quoting grammar (single-quoted string literals, escaped `''`
inside them, bracketed/quoted identifiers, comments, etc.) can be fooled by
adversarial input embedded in a literal.

**Fix:** stop classifying SQL text entirely. Make SQLite's own `PRAGMA
query_only` the security boundary:

- Added `runReadOnly<T>(fn)` in `src/mcp/sqlite-server.ts`, which sets
  `PRAGMA query_only = ON`, runs the query, and resets it to `OFF` in a
  `finally` (so a thrown error can never leave the pragma stuck on).
- The `query` tool now calls `db.query(sql).all()` inside `runReadOnly`. Under
  `query_only = ON`, SQLite itself rejects any write (`INSERT`/`UPDATE`/
  `DELETE`/`DROP`/`CREATE`/data-modifying CTEs, …) with a genuine engine
  error (`attempt to write a readonly database`) while `SELECT` and
  `WITH…SELECT` continue to execute normally — this is enforced by SQLite's
  parser/planner, so no string-literal or paren-nesting trick can confuse it.
- The `query` tool's catch block now distinguishes that specific engine error
  (`/readonly database/i`) and returns the existing "query only accepts
  read-only … use the execute tool for writes" `isError` message; any other
  thrown error still falls back to the original "query failed: …" message.
- The `execute` (write) tool now explicitly runs `PRAGMA query_only = OFF`
  before every write, as defense in depth against the pragma ever leaking
  from the `query` tool into a write path (belt-and-suspenders on top of the
  `finally` reset).
- Deleted `stripParenGroups` and `isReadOnlyQuery` entirely — there is no
  textual classifier left in the file; the engine is the only gate.

**Tests (`tests/mcp/sqlite-server.test.ts`), TDD:** added a new test,
`sqlite MCP server: query tool cannot be bypassed via a string-literal
trick`, covering:
- The exact bypass payload → `isError: true`, and the table's row count is
  asserted unchanged both immediately after and at the end of the test
  (proves the `DELETE` never executed).
- `WITH x AS (SELECT 1) SELECT * FROM x` → allowed, rows returned.
- Plain `SELECT` → allowed.
- `INSERT`/`UPDATE`/`DELETE`/`DROP`, and a plain (non-bypass) `WITH…DELETE` →
  all rejected, row count unchanged after every attempt.
- The `execute` tool still successfully writes a row *after* the `query`
  tool has run (regression guard proving `query_only` didn't leak into the
  write path).

**RED → GREEN, confirmed live:**
- Stashed `src/mcp/sqlite-server.ts` (reverting only the fix, keeping the new
  test) and ran `bun run test:file -- "tests/mcp/sqlite-server.test.ts"`
  against the pre-fix (7bceded) classifier: the bypass-payload assertion
  failed — `expect(bypassResult.isError).toBe(true)` received `false` — i.e.
  the DELETE was classified as read-only and actually ran. 1 fail / 2 pass.
  Popped the stash to restore the fix.
- After the fix: `bun run test:file -- "tests/mcp/sqlite-server.test.ts"` →
  3 pass, 0 fail, 31 `expect()` calls.

**Verification (inline only, full suite intentionally not run):**
- `bun run typecheck` → 0 errors (`tsc --noEmit` clean).
- `bun run lint:file -- "src/mcp/sqlite-server.ts" "tests/mcp/sqlite-server.test.ts"`
  → clean (one formatting fix auto-applied via `--write`, then re-checked
  clean).
- `bun run test:file -- "tests/mcp/sqlite-server.test.ts"` → 3 pass, 0 fail,
  31 `expect()` calls.

**Concerns / notes:**
- `bun:sqlite`'s prepared-statement object exposes no `.readonly` flag (only
  `native`, `safeIntegers`, `as`, `columnNames`, `columnTypes`,
  `declaredTypes`, `paramsCount`, `finalize`), so option 3 from the brief
  (reject on `!stmt.readonly`) isn't available in this driver — used option 1
  (`PRAGMA query_only`), which is the most robust option this driver
  supports and requires no new dependency.
- `PRAGMA query_only = ON` is a connection-level (not statement-level)
  setting; the single shared `db: Database` instance is used by both tools,
  so correctness depends on the pragma being reset before any write can run.
  This is covered by both the `finally` in `runReadOnly` and the explicit
  reset at the top of the `execute` tool, and by the new regression test
  that writes *after* the query tool has executed.
- No new dependencies; `bun:sqlite` is built in.

**Commit:** `fix(mcp): enforce sqlite read-only via engine (PRAGMA query_only), fixing string-literal gate bypass`
