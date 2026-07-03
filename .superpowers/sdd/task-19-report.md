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
