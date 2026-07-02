# Task 4 Report: `bun:sqlite` server + starter pack + `bun run mcp` CLI (Slice 15)

## Summary

Implemented all components in TDD order per brief (Steps 1–10). Followed constraints: no new npm deps, string `${VAR}` literals (dormancy handles unset keys), no archived @modelcontextprotocol packages.

## What was built

1. **`src/mcp/sqlite-server.ts`** (70 lines) — stdio MCP server on bun:sqlite
   - DB path from `process.argv[2]` (defaults `:memory:`)
   - Tools: `query` (SELECT → rows JSON), `execute` (statement → {changes}), `schema` (tables + columns)
   - Error handling via textResult(err.message, isError=true)
   - No console.log (not CLI, kept silent per brief)

2. **`src/mcp/pack.ts`** (100 lines) — curated starter-pack catalog (12 entries)
   - Exported: `STARTER_PACK[]`, `getPackEntry(name)`, `packByCapability(cap)`
   - Entries: file-tools, sqlite, filesystem, memory, sequential-thinking, fetch, git, time, playwright, github, brave-search, exa-search
   - Keyed entries (github, brave-search, exa-search) use literal `${VAR}` strings (dormancy handles unset keys at load time)
   - Added `// biome-ignore lint/suspicious/noTemplateCurlyInString` comments for intentional placeholders
   - Never emits archived packages (server-postgres/server-sqlite/server-brave-search/server-puppeteer/server-github)

3. **`src/cli/mcp.ts`** (70 lines) — CLI with three commands
   - `bun run mcp list` — shows all 12 starter-pack entries, their capabilities, and status (✓ if configured)
   - `bun run mcp status` — shows active/dormant configured servers from mcp.json
   - `bun run mcp add <name>` — adds pack entry to mcp.json (atomic temp+rename write)
   - Exported: `addPackEntry(name, configPath?)` for tests
   - Refuses to overwrite existing same-name entries
   - Console.log allowed per brief for CLI output

4. **`package.json`** — added `"mcp": "bun run src/cli/mcp.ts"` script after `provision`

5. **Tests** (all passing):
   - `sqlite-server.test.ts` (1 test) — real subprocess round-trip via mountMcpServer: schema/execute/query
   - `pack.test.ts` (5 tests) — 12 unique entries, descriptions, ≥1 capability each, queryable by capability, keyed env refs, no archived packages
   - `cli-add.test.ts` (4 tests) — creates mcp.json when absent, appends without disturbing existing entries, refuses overwrite, rejects unknown names

## Lint & Type Audit

**Issues encountered:**
- Template string placeholders (`${GITHUB_PAT}`, etc.) flagged as suspicious → added biome-ignore comments (dormancy contract, per brief's note on string ${VAR} handling)
- Import sorting in mcp.ts (`STARTER_PACK, getPackEntry` → sorted to `getPackEntry, STARTER_PACK`)
- Void return statements (`return func()` where func returns void) → changed to separate call + `return;`
- Formatting (line breaks, indentation) → applied `biome --fix` to all 3 src files

**Results:**
- Typecheck: ✅ clean (0 errors)
- Lint: ✅ clean (0 errors/warnings after fixes; `biome check src/mcp/sqlite-server.ts src/mcp/pack.ts src/cli/mcp.ts`)
- Format: ✅ clean (biome --fix applied and verified)

## Test Results

```
Ran 10 tests across 3 files
10 pass, 0 fail, 46 expect() calls

sqlite-server.test.ts:   1 pass
pack.test.ts:            5 pass
cli-add.test.ts:         4 pass
```

**Smoke test:** `bun run mcp list` outputs all 12 starter-pack entries with names, capabilities, descriptions, and env-key markers (🔑) for keyed entries.

## Commit

```
[slice-15-mcp-mounts 62898f8] feat(mcp): bun:sqlite server + capability-tagged starter pack + bun run mcp CLI (Slice 15 Task 4)
7 files changed, 400 insertions(+)
- src/mcp/sqlite-server.ts
- src/mcp/pack.ts
- src/cli/mcp.ts
- package.json
- tests/mcp/sqlite-server.test.ts
- tests/mcp/pack.test.ts
- tests/mcp/cli-add.test.ts
```

Pre-commit docs-check hook passed ✅

## Code Quality

- **No console.log in src/mcp/** (silent servers per brief)
- **Console.log in src/cli/mcp.ts** (CLI output, allowed)
- **Type over interface** throughout (PackEntry used from Task 1)
- **Early returns** used consistently
- **addPackEntry:** atomic write (temp → rename, no overwrites)
- **String ${VAR} handling:** literal strings, dormancy layer resolves at load time
- **No new npm deps:** uses bun:sqlite natively
- **Exports for tests:** `addPackEntry` exported from cli/mcp.ts for test suite

## Self-review

- All brief code (Steps 1–10) implemented in order: test-first → code → pass → lint → commit
- Brief constraints honored: `${VAR}` literals, no archived packages, no new deps, dormancy-ready
- sqlite-server test: real subprocess mount (mountMcpServer) with three tools tested end-to-end
- pack test: 12-entry validation, capability queries, keyed-entry env refs, archived-package rejection
- cli-add test: file creation, appending, refusal to overwrite, unknown-name handling
- Lint issues fixed with biome-ignore comments (intended behavior for dormancy) + formatting
- No concerns or workarounds needed

## Review Fixes

### Defect 1 — `query` tool write enforcement (Task 4 review)

**Issue:** The `query` tool claimed to be read-only but enforced nothing—a DELETE would execute via `db.query(sql).all()`.

**Fix:** Added gate before executing query:
```ts
const trimmed = sql.trim();
if (!/^select\b/i.test(trimmed)) {
  return textResult('query only accepts SELECT statements; use the execute tool for writes', true);
}
```

Updated description to be precise: "Run a SQL SELECT against the ${dbPath} SQLite database and return rows as JSON. Only SELECT statements are accepted; use execute for writes."

### Defect 2 — `schema` tool identifier quoting (Task 4 review)

**Issue:** Table introspection used `JSON.stringify(t.name)` to quote identifiers. JSON backslash-escaping is not SQLite identifier quoting; breaks on legal names containing a double quote.

**Fix:** Replaced with proper SQLite identifier quoting:
```ts
columns: db
  .query(`PRAGMA table_info("${t.name.replace(/"/g, '""')}")`)
  .all(),
```

This correctly escapes embedded quotes as `""` per SQLite identifier syntax.

### Regression Tests Added

Extended `sqlite-server.test.ts` with four new assertions (after baseline SELECT, before close):

1. **Write rejection:** `query` rejects DELETE; returns `isError: true`
2. **Survival test:** Deleted row still exists (DELETE didn't execute)
3. **Quoted identifiers:** `schema` handles table names with embedded double quotes; introspection succeeds and includes both the weird-named table and the notes table in output
4. **Invalid SQL:** Malformed SQL in `execute` surfaces as `isError: true`, not a throw

**Test results:**
```
bun test v1.3.11
1 pass, 0 fail, 10 expect() calls
```

All new assertions passed.

### Quality Audit

- **Typecheck:** ✅ clean (0 errors)
- **Lint:** ✅ clean (0 errors/warnings; biome check passed)
- **Format:** ✅ clean (formatter applied and verified)
