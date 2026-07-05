# Task 8 Report: Model-degradation chain (Slice 21)

## Status
✅ **COMPLETE**

## Commits
- `69a224d` feat(reliability): failure-domain-aware model-degrade chain

## Test Summary
All 3 tests passing (failureDomain domain identity, degradeChain interleaving, degradeChain passthrough for single domain).

## Implementation
- **Module**: `src/reliability/degrade.ts`
- **Exports**:
  - `type FailureDomain = string` — identity for "the thing that could be down" (runtime + endpoint)
  - `failureDomain(decl): FailureDomain` — returns `String(decl.runtime)` (today: runtime only)
  - `degradeChain(candidates): ModelDeclaration[]` — reorders candidates so consecutive entries never share a failure domain when a different-domain candidate exists; stable within domain; passthrough when only one domain

## Algorithm
1. Extract a candidate pool and output array
2. Loop while pool is non-empty:
   - Find the first candidate with a *different* failure domain than the last pick
   - If none found (all remaining are same domain), take the first
   - Remove from pool and add to output
   - Update `lastDomain` for the next iteration
3. Return reordered chain

This ensures a dead daemon (e.g., Ollama) isn't "degraded" to another Ollama model when an MLX candidate is available — a key robustness contract for the `resolveModel` selector.

## Lint & Typecheck
- ✅ `bun run typecheck` — no errors
- ✅ `bun run lint:file` — no errors
- ✅ Focused test: `bun test tests/reliability/degrade.test.ts` — 3/3 pass

## Notes
- Refactored to avoid non-null assertions; uses explicit undefined check for TypeScript safety
- Imports and formatting fixed per project style (biome)
- Test suite covers domain identity, interleaving correctness, and single-domain passthrough
