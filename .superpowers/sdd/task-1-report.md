# Task 1 Report — Focus-visible design token + remove composer's `focus:outline-none` + `.sr-only` utility (D1)

## Status: DONE

## Branch
`slice-30b-phase8-polish-a11y` (current branch at task start; no new branch cut — task ran on the existing Slice 30b Phase 8 branch).

## Commit
`c8c30c5` — `feat(a11y): app-wide focus-visible ring token + sr-only utility (D1)`

Files changed (4, exactly as specified in the brief):
- `web/src/shared/design/tokens.css`
- `web/src/shared/design/tokens.test.ts`
- `web/src/shared/ai-elements/prompt-input.tsx`
- `web/src/shared/ai-elements/smoke.test.tsx`

## What was done (TDD, per brief)
1. Read `.superpowers/sdd/task-1-brief.md` first — verified the existing content and line numbers of all 4 target files matched the brief's assumptions exactly (no drift, no deviations needed).
2. **Step 1 (failing tests):** appended the brief's verbatim `describe('a11y foundations (D1)', ...)` block to `tokens.test.ts` (assertion 1: `--color-focus-ring:\s*#[0-9A-Fa-f]{6}` regex + `:focus-visible\s*\{[^}]*outline:[^}]*var\(--color-focus-ring\)` regex; assertion 2: `.sr-only\s*\{` presence + `clip:\s*rect\(0,\s*0,\s*0,\s*0\)` regex), and the verbatim new `it(...)` to `smoke.test.tsx` asserting the composer textarea's className no longer contains `outline-none`.
3. **Step 2 (verify red):** ran `bun run test -- design/tokens.test.ts ai-elements/smoke.test.tsx` — 3 failures as expected (`.sr-only` rule absent, `:focus-visible` rule absent, textarea still had `outline-none`); 7 pre-existing tests in the same files still passed.
4. **Step 3 (implement):**
   - `tokens.css`: added `--color-focus-ring: #4C8DFF;` to the `@theme` block (with the brief's rationale comment about keeping it separate from `--color-accent`), and appended a global `:focus-visible { outline: 2px solid var(--color-focus-ring); outline-offset: 2px; }` rule plus a `.sr-only` clip-rect utility class — both placed after the `body{}` block and before the `@media (prefers-reduced-motion: reduce)` block, exactly as specified.
   - `prompt-input.tsx:53`: removed `focus:outline-none` from the textarea's className, keeping `focus:border-[var(--color-accent)]` and every other class untouched.
5. **Step 4 (verify green):** `bun run test -- design/tokens.test.ts ai-elements/smoke.test.tsx` → 2 files passed, 10/10 tests passed. `bun run typecheck` → clean, no errors.
6. **Full per-task gate:** `cd web && bun run typecheck && bun run test` → typecheck clean; full suite **56 test files / 287 tests passed**. (Some `ECONNREFUSED` stack-trace noise appears in the output mid-run — that's expected error-path logging from a pre-existing connection-failure test, not a real failure; the final summary is all-green.)
7. Committed the 4 files with the exact conventional-commit subject from the brief plus a short body and the required `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` trailer. The pre-commit `docs-check` hook ran automatically and passed.

## Test summary
- Targeted run (`tokens.test.ts` + `smoke.test.tsx`): 10/10 passed.
- Full web suite: 287/287 tests passed across 56 files.
- Typecheck: clean.

## Deviations from the brief
None. File contents and line numbers matched the brief's assumptions exactly; tests went red then green as expected with no code changes beyond what the brief specified.

## Concerns
- None functionally. Two files outside this task's scope showed up as changed/untracked in `git status` before I committed — `.superpowers/sdd/task-1-brief.md` (already modified in the working tree when I started, presumably regenerated for this phase by surrounding SDD-controller activity) and an untracked `.remember/today-2026-07-19.md` (hook-managed continuity buffer). Neither is in this task's file list, so both were deliberately left out of the commit (confirmed via `git status --short` immediately before committing — only the 4 intended files were staged).
