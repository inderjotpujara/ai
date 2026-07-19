# Task 8 Report: vitest-axe harness + baseline no-violations + dedicated tab-widget keyboard-nav test (D4)

(Note: this filename was previously used by an earlier Slice-30b-Phase-6
Task 8 and a Phase-7 Task 8 — both preserved in git history/merge commits.
This report is for the current Phase 8, Increment 1, Task 8.)

## Status: DONE_WITH_CONCERNS (resolved inline — see below)

## What was done

Followed the brief's TDD steps:

1. **Step 1** — created `web/src/app/a11y-baseline.test.tsx` and
   `web/src/app/tab-widget-keyboard.test.tsx` verbatim per the brief.
2. **Step 2** — confirmed the expected split: `a11y-baseline.test.tsx` failed
   at module resolution (`vitest-axe` not installed); `tab-widget-keyboard.test.tsx`
   passed immediately (2/2) — it's a characterization test locking in Tasks 6/7's
   already-shipped roving-tabindex/tabpanel-linkage behavior, not new functionality,
   exactly as the brief said to expect and note honestly.
3. **Step 3** — `bun add -D vitest-axe` (resolved/pinned `vitest-axe@0.1.0`, the
   only version on npm). Wired `expect.extend(axeMatchers)` into
   `web/src/test/setup.ts` per the brief.
4. **Step 4** — ran the targeted tests, full suite, and typecheck.

## Deviations from the brief (both required to actually reach green)

**1. Real pre-existing a11y violation on Runs (`/runs`).** The axe baseline
caught three unlabeled `<select>` elements — `runs-outcome-filter`,
`runs-degraded-filter`, `runs-kind-filter` in `web/src/features/runs/index.tsx`
— each failing axe's `select-name` rule ("Select element must have an
accessible name"). Checked Task 2's brief/report: Task 2 (D1, real labels)
scoped only the composer textarea and the Settings model-tier select — the
Runs facet selects were never in scope for any earlier task. This is squarely
within Phase 8's WCAG AA labeling charter and a one-line fix per select, so
per the standing "no deferred debt" policy I folded it in rather than
suppressing or deferring: added `aria-label="Filter by outcome"` /
`"Filter by degraded status"` / `"Filter by run kind"` to the three selects.
Flagging this explicitly per instructions — no other screen (Chat, Sessions,
Library, Builders, Settings) had any violations.

**2. `vitest-axe@0.1.0` type augmentation is stale for vitest 4.** After the
brief's exact `setup.ts` wiring, `bun run test` passed but `bun run typecheck`
failed: `Property 'toHaveNoViolations' does not exist on type
'Assertion<AxeResults>'` on all 6 baseline assertions. Root cause: vitest-axe's
own `extend-expect.d.ts` augments `declare global { namespace Vi { interface
Assertion } }` — the pre-v2 Vitest matcher-typing convention. Vitest 4's
`vitest`/`@vitest/expect` packages export their own `Assertion`/
`AsymmetricMatchersContaining` interfaces directly and no longer merge with
that global namespace (confirmed by inspecting how `@testing-library/jest-dom`
— already working in this repo — augments types: it does `declare module
'vitest' { interface Assertion ... }`, not the `Vi` global). Added a small
compatibility shim, `web/src/test/vitest-axe.d.ts`, re-declaring the
augmentation the way vitest 4 expects, importing `AxeMatchers` from
`vitest-axe/matchers` (pure type-only import, no runtime effect — the actual
`expect.extend(axeMatchers)` call is unchanged, still exactly once, in
`setup.ts`). This is scoped narrowly (one small `.d.ts` file, no behavior
change) and was necessary to satisfy `bun run typecheck` per the global gate.

## Verification

- `cd web && bun run test -- app/a11y-baseline.test.tsx app/tab-widget-keyboard.test.tsx` → 2 files, 8/8 pass (6 baseline screens + 2 keyboard-nav checks).
- `cd web && bun run test` → 61 files, 315/315 pass (full suite, no regressions; was 307 tests pre-task).
- `cd web && bun run typecheck` → clean.
- `bun run lint:file` on all touched/created files → clean (biome auto-fixed one line-width wrap in the copied-verbatim baseline test file).

## Files touched

- `web/package.json`, `bun.lock` — new devDependency `vitest-axe@0.1.0`.
- `web/src/test/setup.ts` — `expect.extend(axeMatchers)` wiring (brief, verbatim).
- `web/src/test/vitest-axe.d.ts` — new: vitest-4-compatible type shim (deviation #2, see above).
- `web/src/app/a11y-baseline.test.tsx` — new: 6 baseline no-violations assertions (brief, verbatim + biome's line-wrap).
- `web/src/app/tab-widget-keyboard.test.tsx` — new: dedicated tab-widget keyboard-nav test (brief, verbatim).
- `web/src/features/runs/index.tsx` — `aria-label` on the 3 Runs filter `<select>`s (deviation #1, see above).

## Commit

`6ec666c` — `test(a11y): vitest-axe harness + baseline no-violations + dedicated tab keyboard-nav test (D4)`

## Concerns for the controller

Both deviations were resolved inline and verified green — nothing is left
outstanding. Flagging per instructions since (1) is a real product a11y fix
folded into a test-harness task, and (2) is an undocumented compatibility gap
in a third-party package's types vs. this repo's vitest major version, in case
either warrants a mention in the phase's closeout notes or the ROADMAP/
architecture docs update for Increment 1's close.
