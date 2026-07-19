# Task 6 report — Library tabs: real keyboard pattern + shared `nextTabIndex` helper (D2)

## Status: DONE

## Summary
Implemented exactly per brief, TDD (red → green):

1. Wrote failing tests first: `web/src/shared/ui/tab-list.test.ts` (new, 4 cases for the pure
   helper) and appended 2 new tests to `web/src/features/library/index.test.tsx` (roving
   tabindex + wrap-around focus, and aria-controls/id/role="tabpanel" linkage). Confirmed both
   files failed for the expected reasons (`tab-list.ts` missing; `LibraryArea` had no
   `tabIndex`/`aria-controls`/`role="tabpanel"`).
2. Created `web/src/shared/ui/tab-list.ts` exporting `nextTabIndex(key, activeIndex, count):
   number | undefined` — ArrowRight/ArrowLeft roving with wrap, Home/End jump-to-ends, `undefined`
   for any other key. Pure, no DOM dependency, independently unit-tested.
3. Replaced `web/src/features/library/index.tsx` with the brief's full content: tabs now carry
   `id`, `aria-controls`, roving `tabIndex` (0 for active, -1 otherwise), an `onKeyDown` handler
   that calls the shared helper and moves both React state (`setTab`) and DOM focus
   (`tabRefs.current[next]?.focus()`); each panel gained `role="tabpanel"` + `aria-labelledby`
   linked to its tab's `id`. Public interface unchanged (`export function LibraryArea()`).
4. Ran the target tests — all passed; ran `bun run typecheck` — clean; ran the full `bun run
   test` suite — all passed (no regressions).
5. Committed the 4 target files only (left the SDD ledger/report files for the controller).

## Files touched
- `/Users/inderjotsingh/ai/web/src/shared/ui/tab-list.ts` (new)
- `/Users/inderjotsingh/ai/web/src/shared/ui/tab-list.test.ts` (new)
- `/Users/inderjotsingh/ai/web/src/features/library/index.tsx` (modified — full rewrite per brief)
- `/Users/inderjotsingh/ai/web/src/features/library/index.test.tsx` (modified — appended 2 tests)

## Test results
- Target scope (`shared/ui/tab-list.test.ts` + `features/library/index.test.tsx`): 7/7 passed
  (4 `nextTabIndex` cases + 1 pre-existing `LibraryArea` test + 2 new D2 tests).
- Full web suite: 306/306 tests passed across 59 files.
- `bun run typecheck`: clean (`tsc --noEmit`, no errors).
- Note: test runs print `ECONNREFUSED ::1:3000 / 127.0.0.1:3000` stack traces — this is
  unrelated pre-existing noise from a component's backend-fetch logging in the jsdom test env
  (no backend running during `bun run test`), not a test failure; all reported tests pass.

## Commit
- `2098c72` — `feat(a11y): Library tabs get real keyboard roving + tabpanel linkage, via a shared helper (D2)`
  (branch `slice-30b-phase8-polish-a11y`, 4 files changed, 128 insertions, 6 deletions)

## Concerns
None. Implementation follows the brief verbatim; helper is DOM-free and directly reusable by
Task 7 (`BuildersArea`) as designed.

Report path: /Users/inderjotsingh/ai/.superpowers/sdd/task-6-report.md
