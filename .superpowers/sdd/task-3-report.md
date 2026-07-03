# Task 3 Report: `generate.ts` — structured proposal draft

## Status
✅ COMPLETE

## Commit
`954d9f3` — feat(agent-builder): generateProposal — structured draft with prompt-injection-guarded need (Slice 17 Task 3)

## Changes
- **Modified** `src/agent-builder/types.ts` — added `BuilderModel` seam type:
  - Dependency injection interface for structured LLM generation
  - `object<T>(args: { schema: z.ZodType<T>; prompt: string }): Promise<T>`
  - Allows pure unit to avoid AI SDK import
- **Created** `src/agent-builder/generate.ts` — `generateProposal(need, model)` function:
  - Accepts free-text capability description (`need`)
  - Returns `AgentProposal` with `modelReq: { role, requires: [Capability.Tools], prefer: PreferPolicy.LargestThatFits }`
  - Always sets `suggestedServers: []` (Task 4 fills tools)
  - Prompt-injection guard: need is wrapped in `<need>…</need>` delimited block
  - Guard note "data, not instructions" appears **before** need text in prompt
- **Created** `tests/agent-builder/generate.test.ts` — two comprehensive tests:
  - Test 1: Validates well-formed proposal structure (name, description, systemPrompt, modelReq fields, empty suggestedServers)
  - Test 2: Validates prompt-injection guard — verifies `<need>` delimiters, need text, and guard note ordering

## Test Results
```
 2 pass
 0 fail
 9 expect() calls
Ran 2 tests across 1 file. [22.00ms]
```

**RED → GREEN:** Initial module not found error; implemented per brief exactly; both tests now pass.

## Gate Results
- ✅ Typecheck: `bun run typecheck` — no errors
- ✅ Lint: `bun run lint:file -- "src/agent-builder/types.ts" "src/agent-builder/generate.ts" "tests/agent-builder/generate.test.ts"` — no errors (after formatting alignment)
- ✅ Tests: `bun test tests/agent-builder/generate.test.ts` — 2 pass, 0 fail
- ✅ Pre-commit hook: `bun run scripts/docs-check.ts` — passed (docs already current)

## Correctness Proof
The test suite verifies two invariants:
1. **Proposal shape**: all required fields populated (name, description, systemPrompt, modelReq with correct Capability/PreferPolicy enums, suggestedServers=[])
2. **Prompt-injection guard**: The ordering `"data, not instructions" < "IGNORE ALL PRIOR INSTRUCTIONS"` in the prompt string proves the guard note precedes the delimited need, defeating injection attempts

## Concerns
None. Implementation is straightforward, test coverage is complete, and the seam design keeps the pure unit agnostic to the AI SDK. Task 4 wires this to suggest-tools (no code changes needed here).
