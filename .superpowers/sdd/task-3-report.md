# Task 3 Report: `withMcpRun` helper + ordering proof

## Status
✅ COMPLETE

## Commit
`bfcf7e3` — feat(cli): withMcpRun helper owns run-dir+telemetry+mount ordering (Slice 16 Task 3)

## Changes
- **Created** `src/cli/with-mcp-run.ts` — new helper that guarantees the correct lifecycle:
  1. Create run dir
  2. Initialize telemetry provider (installs run-scoped OTel)
  3. Mount MCP **under the live provider** (so `mcp.mount` span lands in `runs/<id>/spans.jsonl`)
  4. Run body
  5. Teardown (close registry, flush telemetry)
- **Created** `tests/cli/with-mcp-run.test.ts` — two tests:
  - Test 1: Verifies `mcp.mount` span reaches `spans.jsonl` (the ordering fix proof)
  - Test 2: Verifies registry is cleanly closed after body

## Test Results
```
 2 pass
 0 fail
 4 expect() calls
Ran 2 tests across 1 file. [119.00ms]
```

**RED → GREEN:** Module initially missing (module not found error), implemented exactly per brief, both tests now pass.

## Gate Results
- ✅ Typecheck: `bun run typecheck` — no errors
- ✅ Lint: `bun run lint:file -- "src/cli/with-mcp-run.ts" "tests/cli/with-mcp-run.test.ts"` — no errors (after formatting fixes)
- ✅ Tests: `bun test tests/cli/with-mcp-run.test.ts` — 2 pass, 0 fail
- ✅ Pre-commit hook: `bun run scripts/docs-check.ts` — passed (no docs changes needed)

## Key Correctness Point
The test proves the ordering invariant: `initRunTelemetry` runs **before** `withMcpMountSpan(mountAll)` inside the helper body. Because telemetry is live before the mount happens, the `mcp.mount` span is created under the active provider and **does appear in `runs/<id>/spans.jsonl`** (verified by parsing the file and asserting `lines.some((s) => s.name === 'mcp.mount')`).

## Concerns
None. The helper is a thin orchestrator that owns the invariant—later tasks (4–6) will rewire the three CLIs to use it in place of their inlined scope logic. This task completes its scope cleanly.
