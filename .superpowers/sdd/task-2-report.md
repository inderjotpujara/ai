# Task 2 Report: agent-builder types + structural validation (Slice 17)

> Note: this file previously held Slice 16 Task 2 report. That work is
> preserved in git history. This file now holds the Slice 17 Task 2 report.

## Status

**✅ COMPLETED**

**Commit:** `36766bf` on branch `slice-17-agent-builder`

## What was built

Pure-logic types + validation for specialist agent generation (Slice 17):

1. **`src/agent-builder/types.ts`**:
   - `SuggestedServer` — packName + scopeToAgent for curated MCP server references
   - `AgentProposal` — drafted agent definition (name, description, systemPrompt, modelReq, suggestedServers, rationale)
   - `ValidationIssue` — field + problem string for structural gate reporting
   - `BuildResult` — discriminated union: written | declined | invalid | abandoned

2. **`src/agent-builder/validate.ts`**:
   - `validateProposal(p: AgentProposal, existingNames: string[], packNames: string[]): ValidationIssue[]`
   - Returns empty array if valid; collects issues for:
     * Name: must be snake_case, not reserved (`super`, `orchestrator`), not in existingNames
     * Description & systemPrompt: must be non-empty (after trim)
     * suggestedServers: each packName must be in packNames (palette-only), and scopeToAgent must equal p.name

3. **`tests/agent-builder/validate.test.ts`**:
   - 7 test cases: clean proposal, duplicate-name rejection, reserved-name rejection, non-snake_case rejection, empty-fields rejection, off-palette-server rejection, mis-scoped-server rejection

4. **`docs/architecture.md`**:
   - Added agent-builder subgraph to mermaid diagram (§AB: abtypes + abvalidate)
   - Added row to the subsystem table documenting agent-builder (Slice 17) with dependencies on core/types (ModelRequirement) and mcp/ (pack registry)

## TDD evidence (RED → GREEN)

**RED** — before creating `types.ts` and `validate.ts`:

```
$ bun test tests/agent-builder/validate.test.ts
bun test v1.3.11 (af24e281)

tests/agent-builder/validate.test.ts:

# Unhandled error between tests
-------------------------------
error: Cannot find module '../../src/agent-builder/validate.ts' 
  from '/Users/inderjotsingh/ai/tests/agent-builder/validate.test.ts'
-------------------------------

 0 pass
 1 fail
 1 error
Ran 1 test across 1 file. [10.00ms]
```

**GREEN** — after implementing `types.ts` and `validate.ts`:

```
$ bun test tests/agent-builder/validate.test.ts
bun test v1.3.11 (af24e281)

 7 pass
 0 fail
 8 expect() calls
Ran 7 tests across 1 file. [10.00ms]
```

All 7 test cases pass: clean proposal, duplicate-name, reserved-name, non-snake_case, empty-fields, off-palette-server, mis-scoped-server.

## Gate results

- **`bun run typecheck`** → clean (`tsc --noEmit`, no output/errors).
- **`bun run lint:file -- "src/agent-builder/types.ts" "src/agent-builder/validate.ts" "tests/agent-builder/validate.test.ts"`**
  → initially flagged 2 issues: test import sort order and line-wrapping in validate.ts.
  Fixed both via import reordering (bun:test imports first, then types, then other imports)
  and wrapping long push() calls across lines. Re-run → `Checked 3 files in 3ms. No fixes applied.` (clean).
- **`bun test tests/agent-builder/validate.test.ts`** → 7 pass, 0 fail, 8 expect() calls.
- **`bun run docs:check`** (pre-commit hook) → passed. Added agent-builder subgraph to mermaid
  diagram and table entry to `docs/architecture.md` documenting the new subsystem.

## Files changed (created/modified)

- `src/agent-builder/types.ts` (created) — type definitions for agent generation
- `src/agent-builder/validate.ts` (created) — structural validation gate
- `tests/agent-builder/validate.test.ts` (created) — 7 test cases, all passing
- `docs/architecture.md` (modified) — added agent-builder (§AB) to mermaid + table

**Commit:** `36766bf` — "feat(agent-builder): AgentProposal types + structural validateProposal (Slice 17 Task 2)" on branch `slice-17-agent-builder`.

## Concerns

None. Task 2 is pure-logic (no I/O, no LLM); all 7 validation rules are exercised by the test suite. Ready for Task 3 (generator).
