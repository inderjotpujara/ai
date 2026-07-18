# Task 19 Report: MCP config — retain transport kind on dormant entries (Phase 5)

## Status: DONE

## What was implemented

Widened `McpConfig['dormant']` to carry the transport `kind` (`McpTransportKind`)
alongside `name` and `missingVars`, and populated it in `loadMcpConfig` when an
entry is demoted to dormant due to unset env vars. This is a pure retention fix:
`entry.kind` is read off the already-built `McpServerEntry` (schema validation +
`toEntry()` construction happen *before* the missing-var check), so no mount
behavior changes — only the dormant record now preserves data that already
existed at that point in the pipeline.

This unblocks Task 20 (`mapMcpDormantToDto`), since `McpServerDTO` requires a
`kind` field even for dormant/unmounted servers.

## Files changed

- `src/mcp/types.ts` — `McpConfig.dormant` entries gain `kind: McpTransportKind`
  (with doc comment explaining why it's safe/available at that point).
- `src/mcp/config.ts` — `loadMcpConfig`'s dormant-push branch now includes
  `kind: entry.kind`.
- `tests/mcp/config.test.ts` — widened the `'marks entries with unset env vars
  dormant, not failed'` test (renamed to `'... — and keeps the transport kind'`)
  to assert the dormant record includes `kind: McpTransportKind.Http`.

## TDD evidence

**RED** (`bun test tests/mcp/config.test.ts` after widening the test only):
```
- Expected  - 1
+ Received  + 0
   {
-     "kind": "http",
      "missingVars": [ ... ]
   }
(fail) loadMcpConfig > marks entries with unset env vars dormant, not failed — and keeps the transport kind
13 pass / 1 fail
```

**GREEN** (`bun test tests/mcp/config.test.ts` after implementation):
```
14 pass
0 fail
30 expect() calls
Ran 14 tests across 1 file. [31.00ms]
```

## Gate results

- `bun run typecheck` — clean (`tsc --noEmit`, no output).
- `bun run lint:file -- src/mcp/types.ts src/mcp/config.ts tests/mcp/config.test.ts`
  — `Checked 3 files in 28ms. No fixes applied.` (0 errors).
- Focused tests: 14/14 pass in `tests/mcp/config.test.ts`.

## Self-review

- Confirmed this is additive/retention-only: `entry.kind` was already computed
  by `toEntry()` before the `missing.length > 0` branch runs, so nothing about
  *which* entries become dormant or *when* mounting happens changed — only the
  recorded shape widened. No STOP/DONE_WITH_CONCERNS trigger (mount behavior
  is untouched).
- Searched for other consumers of `cfg.dormant` / `McpConfig['dormant']` in
  `src/` — none exist yet (Tasks 20/21, the mapper and list endpoint, are
  still pending), so no other call sites needed updates.
- `git status` / `git show --stat HEAD` confirm only the three intended files
  were staged and committed; no incidental changes swept in.

## Concerns

None. Change is a minimal, type-safe field addition consistent with existing
`src/mcp/` idioms (matches how `entries` already carry `kind` via the
discriminated `McpServerEntry` union).

## Commit

`4445dc0` — `feat(mcp): retain transport kind on dormant config entries (Phase 5)`

## Note on file history

This report file previously held a stale Task-19 entry from an earlier
Phase-4 task-numbering scheme (⌘K jump-to-crew/jump-to-workflow commands,
commit `e695ee6`). It has been fully overwritten per the brief's instruction
for this slice's Task 19; nothing from the old content was preserved or merged.
