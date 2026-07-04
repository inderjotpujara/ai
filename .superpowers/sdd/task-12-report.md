# Task 12 report (Slice 19): CREW-BUILDER registry markers

NOTE: this file previously held a stale report from an unrelated Slice-18
task ("MLX opt-in runtime selection with degrade-to-Ollama") that reused the
`task-12` filename under that slice's numbering. Replaced below with the
correct report for Slice 19 Task 12.

## Summary

Added `// CREW-BUILDER:IMPORTS` and `// CREW-BUILDER:ENTRIES` marker
comments to `crews/index.ts` and `workflows/index.ts`, mirroring the existing
`// AGENT-BUILDER:IMPORTS`/`:ENTRIES` pattern in `agents/index.ts`. These
markers are the insertion points a later task (`src/crew-builder/write.ts`)
will use to splice in generated crew/workflow registrations. Purely additive
— the pre-existing `researchCrew` and `fetchThenSummarize` registrations are
untouched.

## Implementation

- `crews/index.ts`: added `// CREW-BUILDER:IMPORTS (generated crew imports
  are inserted above this line — do not remove)` immediately after the last
  import (`import researchCrew from './research-crew.ts';`), and `//
  CREW-BUILDER:ENTRIES (generated crew entries are inserted above this line —
  do not remove)` as the last line inside the `CREWS` record body, before the
  closing `};`.
- `workflows/index.ts`: same treatment for `WORKFLOWS`/`fetchThenSummarize`.

## TDD RED → GREEN

1. Wrote `tests/crew-builder/markers.test.ts` per the brief — loops over
   `['crews/index.ts', 'workflows/index.ts']` and asserts each file's source
   `toContain`s both marker strings.
2. RED: `bun test tests/crew-builder/markers.test.ts`
   → `0 pass, 2 fail` (both files missing `// CREW-BUILDER:IMPORTS`).
3. Edited both index files as described above.
4. GREEN: `bun test tests/crew-builder/markers.test.ts`
   → `2 pass, 0 fail, 4 expect() calls`.

## Verification

- `bun run typecheck` → clean (`tsc --noEmit`, no output/errors).
- `bun test tests/crew-builder/` → `34 pass, 0 fail` across 10 files (no
  regressions in the broader crew-builder suite).
- `bun test tests/crew/` → `21 pass, 0 fail` (crew registry/runtime behavior
  unaffected by the additive markers).
- `bun run lint:file -- crews/index.ts workflows/index.ts
  tests/crew-builder/markers.test.ts` → `Checked 3 files in 2ms. No fixes
  applied.`

## Files touched

- `/Users/inderjotsingh/ai/crews/index.ts` (modified — markers added)
- `/Users/inderjotsingh/ai/workflows/index.ts` (modified — markers added)
- `/Users/inderjotsingh/ai/tests/crew-builder/markers.test.ts` (new)

## Commit

`d7b0911` — "feat(crew-builder): registry markers in crews/ + workflows/
index". Staged only the three files above via explicit `git add
crews/index.ts workflows/index.ts tests/crew-builder/markers.test.ts` (not
`-A`) since numerous unrelated SDD-scratch/`.remember` files from sibling
parallel tasks were present in the working tree. Pre-commit `docs-check` hook
passed (additive change, no `src/**` touched, no architecture-doc update
needed).

## Self-review

- Marker text and placement match the brief's example verbatim.
- Confirmed via `git status --short` before commit that no other files were
  staged.
- No `console.log` introduced.
- Verified `git status --short` also showed a stray stale copy of this exact
  report (pre-existing, from the wrong slice) was already in the working
  tree before I overwrote it — a pre-existing filename collision from SDD
  ledger numbering across slices, not something this task introduced.

## Concerns

- None functional. The only note-worthy item is the stale-report filename
  collision described above (an SDD bookkeeping artifact from a prior slice
  reusing `task-12-report.md`, unrelated to this task's code change).
