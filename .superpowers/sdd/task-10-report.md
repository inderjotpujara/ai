# Task 10 Report — Result mapper: `toBuildResultDto`/`toCrewBuildResultDto`

## Status: DONE

## What was implemented

Two pure projection functions in `src/server/builders/map-result.ts`:

- `toBuildResultDto(result: BuildResult): BuildResultDTO` — flattens the agent
  builder's `BuildResult` (`src/agent-builder/types.ts:22-38`) onto the wire
  `BuildResultDTO` (`src/contracts/dto.ts`). The `written` variant carries the
  **full** `AgentProposal` through onto `BuildResultDTO.proposal` (it's
  JSON-safe per D5 and structurally satisfies `AgentProposalDtoSchema`
  field-for-field), so the wizard (Task 14) can render the post-write
  proposal DagView without a second round-trip. All other variants
  (`declined`, `invalid`, `abandoned`, `reused`, `failed-verification`) are
  passed through 1:1.
- `toCrewBuildResultDto(result: CrewBuildResult): BuildResultDTO` — flattens
  `CrewBuildResult` (`src/crew-builder/types.ts:13-31`) onto the same wire
  shape. Documented in the code that `CrewBuildResult.written` does **not**
  carry the committed `CrewIR`/`WorkflowIR` back (only `name`/`files`/
  `builtAgents`) — a pre-existing engine-side gap (not introduced by this
  task), which is why the crew/workflow wizard shows a plain result card
  instead of a post-write DagView for `written` crew results.

Both functions are pure (no I/O), mirroring the Task-9 adapter and existing
run-dto mapper style.

## Interface verification (no discrepancies)

Read the engine source-of-truth before implementing:
- `src/agent-builder/types.ts:22-38` (`BuildResult`) — matches the brief
  exactly (6 variants: written/declined/invalid/abandoned/reused/
  failed-verification).
- `src/crew-builder/types.ts:13-31` (`CrewBuildResult`) — matches the brief
  exactly (same 6 variants, `written` additionally carries `shape` and
  `builtAgents`, neither of which the DTO needs).
- `src/contracts/dto.ts` — `BuildResultDTO` shape confirmed compatible with
  both mapper outputs.

No field mismatches found; implemented exactly as the brief specified.

## TDD evidence

**RED** — before creating `src/server/builders/map-result.ts`:
```
error: Cannot find module '../../src/server/builders/map-result.ts' from '/Users/inderjotsingh/ai/tests/server/builders-map-result.test.ts'
 0 pass
 1 fail
 1 error
```

**GREEN** — after implementing the mapper:
```
bun test v1.3.11 (af24e281)
 2 pass
 0 fail
 7 expect() calls
Ran 2 tests across 1 file. [15.00ms]
```

## Gate results

- `bun run typecheck` — clean (`tsc --noEmit`, no output).
- `bun run lint:file -- src/server/builders/map-result.ts tests/server/builders-map-result.test.ts`
  — 0 errors after two fixes (see below), 0 warnings.
- Focused test — 2 pass / 0 fail, 7 assertions (see GREEN above).

### Lint fixes applied (deviations from the brief's literal test snippet)

1. Removed the unused `BuildResult` type import from the test file (the
   brief's snippet imports it but only uses `AgentProposal` directly — the
   inline object literals passed to `toBuildResultDto` don't need the type
   annotation). Biome's `noUnusedImports` flagged this as a real error, not a
   style nit.
2. Ran `bunx biome check --write` on both files to apply the project's
   formatter (multi-line object/import wrapping) — purely mechanical
   reformatting, no logic change. Confirmed via re-run of `lint:file`
   (0 errors/warnings) and the focused test (still 2 pass / 0 fail) after the
   fix.

## Files changed

- `src/server/builders/map-result.ts` (new, 77 lines)
- `tests/server/builders-map-result.test.ts` (new, 77 lines)

## Self-review

- Both switch statements are exhaustive over the 6-variant discriminated
  unions; `tsc --noEmit` passed with no "not all code paths return a value"
  complaint, confirming exhaustiveness.
- No I/O, no side effects — pure functions, consistent with Task 9's adapter
  and the existing run-dto mapper style referenced in the brief.
- Docstrings preserved verbatim from the brief, including the explicit note
  about the `CrewBuildResult` IR gap so future readers don't mistake it for
  an oversight in this task.
- `bun run docs:check` (pre-commit hook) passed — no living-doc updates
  required for this internal pure-mapper addition (consistent with Task 9,
  which also required none).

## Concerns

None. Engine types matched the brief's cited line ranges exactly; the only
required deviations were the two mechanical lint fixes above (unused import
removal + formatter pass), which don't change behavior or the interfaces
specified in the brief.

## Commit

`40024cd` — `feat(server): BuildResult/CrewBuildResult → BuildResultDTO mapper (Phase 5)`
