# Task 4: `suggest-tools.ts` — Slice 17 Report

**Status:** ✅ COMPLETE

**Commit:** `f281950` — feat(agent-builder): suggestServers — minimal palette-only scoped tool pick (Slice 17 Task 4)

## Summary

Implemented `suggestServers(need, proposal, model, pack?)` to pick the minimal curated-pack MCP server subset an agent needs. The model is constrained to only pick from the presented palette (least-privilege, no invention); results are deduped and scoped to the agent.

## Files Created

1. **`src/agent-builder/suggest-tools.ts`** — Core implementation.
2. **`tests/agent-builder/suggest-tools.test.ts`** — TDD test suite with 4 cases.

## Changes Detail

### `src/agent-builder/suggest-tools.ts`
- Exports `suggestServers(need, proposal, model, pack = STARTER_PACK): Promise<SuggestedServer[]>`
- Zod schema `PickSchema` ensures model output is `{ servers: string[] }`.
- Builds palette string from `pack` entries (name, description, capabilities).
- Wraps need text in `<need>…</need>` guard so it's treated as data, not instructions.
- Filters model picks: retains only names in `pack`, dedupes via `Set`, returns `SuggestedServer[]` with each scoped to `proposal.name`.

### `tests/agent-builder/suggest-tools.test.ts`
Four test cases (all PASS):
- **returns only pack names, scoped to the agent:** model picks `['filesystem']` → `[{ packName: 'filesystem', scopeToAgent: 'pdf_qa' }]`
- **drops names not in the pack:** model picks `['filesystem', 'evil']` → filters to `[{ packName: 'filesystem', ... }]`, never invents
- **dedupes repeats:** model picks `['fetch', 'fetch']` → `[{ packName: 'fetch', ... }]`
- **returns [] when model picks nothing:** `pick([])` → `[]`

## TDD: RED → GREEN

**RED** (test run before implementation):
```
error: Cannot find module '../../src/agent-builder/suggest-tools.ts'
 0 pass
 1 fail
 1 error
```

**GREEN** (after implementation):
```
 4 pass
 0 fail
 4 expect() calls
Ran 4 tests across 1 file. [22.00ms]
```

## Gate Results

- **Typecheck:** ✅ PASS (`bun run typecheck` → clean, no output)
- **Lint:** ✅ PASS (`bun run lint:file` → `Checked 2 files in 3ms. No fixes applied.`)
  - Required formatting fixes: broke long Zod chain, reorganized test imports, formatted objects/arrays across multiple lines.
- **Docs-check (pre-commit hook):** ✅ PASS (`✔ docs-check: living docs present + linked; every src subsystem documented.`)
- **Full test suite:** Not re-run (task-scoped), but new tests confirm isolated module correctness.

## Concerns

None. All test cases pass, all gates pass, implementation matches spec exactly, formatting is clean.

