# Task 7 Report: Builders tabs — reuse the same `nextTabIndex` helper (D2)

## Summary
Applied the WAI-ARIA tabs keyboard pattern to `BuildersArea` (`web/src/features/builders/index.tsx`), reusing the pure `nextTabIndex` helper from `web/src/shared/ui/tab-list.ts` extracted in Task 6 (no duplicate helper code). Matches Library's automatic-activation model: arrow keys move focus and immediately switch mode.

## TDD steps followed
1. Appended the new test to `web/src/features/builders/index.test.tsx` (verbatim from brief).
2. Ran `bun run test -- features/builders/index.test.tsx` — confirmed the new test FAILED (`tabIndex` attribute was `null`), pre-existing test still passed. 1 passed / 1 failed as expected.
3. Replaced `web/src/features/builders/index.tsx` with the brief's full new content: added `TABS` array, `tabRefs`, `onTabKeyDown` (delegates to `nextTabIndex`), roving `tabIndex`, `id`/`aria-controls` linkage, and wrapped each wizard in a `role="tabpanel"` div with matching `id`/`aria-labelledby`.
4. Ran the test file again — both tests passed (2/2).
5. Ran `bun run typecheck` — clean (`tsc --noEmit`, no errors).
6. Ran full `bun run test` — 59 test files / 307 tests, all passed.
7. Committed.

## Files changed
- `web/src/features/builders/index.tsx` — full replacement per brief (roving tabindex, tabpanel roles, aria-controls linkage).
- `web/src/features/builders/index.test.tsx` — appended the new keyboard-nav test.

## Verification evidence
- `cd web && bun run test -- features/builders/index.test.tsx` → Test Files 1 passed (1), Tests 2 passed (2).
- `cd web && bun run typecheck` → clean, no errors.
- `cd web && bun run test` (full suite) → Test Files 59 passed (59), Tests 307 passed (307).
- Pre-existing `data-testid`s (`builders-mode-agent`, `builders-mode-crew`) preserved; `BuildersArea` export signature unchanged.

## Commit
`2c1176c` — `feat(a11y): Builders tabs reuse the shared roving-tabindex helper (D2)` on branch `slice-30b-phase8-polish-a11y`.

## Concerns / notes
- An unrelated `ECONNREFUSED 127.0.0.1:3000` / `::1:3000` AggregateError appears in test stderr output during every run (pre-existing, unrelated to this change — some background process/test attempting a network connection). It does not affect test pass/fail counts and was present before this task's changes.
- No new helper code was added; `nextTabIndex` was imported as-is from Task 6's `web/src/shared/ui/tab-list.ts`, consistent with the "don't duplicate" instruction.
- This report file (`task-7-report.md`) was found pre-populated with stale content from an unrelated earlier task (Phase 7 `stt.worker.ts` voice work, task-number reused across phases) and has been overwritten with this report.
