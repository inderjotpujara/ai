# Task 14 Report (Slice 30b Phase 8, Increment 2): `mic-button.tsx` — `aria-live="polite"` status region (D5)

> Note: this file previously held a report for an unrelated "Task 14" from
> Phase 7 (the initial MicButton + Waveform build). That content is
> superseded here per this task's explicit instruction to write this
> Phase-8 report to this exact path; the prior content remains in git
> history if needed.

**Status:** DONE — all steps in the brief completed verbatim, gate green, committed. Closes Increment 2.

## What changed
`web/src/features/voice/mic-button.tsx` — the outer `data-testid="mic-button"`
wrapper now carries `aria-live="polite"` and `aria-atomic="true"`, so the three
previously-silent `VoiceStatus` transitions are announced to screen readers:
the "Loading voice model…" span, the "● Listening" label swapped into the hold
button, and the interim-transcript span while transcribing. The error span's
own separate `role="alert"` (implicitly `aria-live="assertive"`) was left
untouched — nesting assertive inside polite is standard, and the inner
assertive announcement still takes precedence for that element. No new
props/exports were introduced.

## TDD evidence
1. Appended the two brief-specified tests to `mic-button.test.tsx`.
2. RED confirmed: `cd web && bun run test -- features/voice/mic-button.test.tsx`
   → both new tests failed (`element.getAttribute("aria-live")` was `null`),
   9 pre-existing tests passed.
3. Applied the minimal implementation change (added the two `aria-*` attributes
   to the wrapper div).
4. GREEN: same command → 11/11 passed.
5. `cd web && bun run typecheck` — clean.

## Gate results
- `cd web && bun run typecheck` — PASS.
- `cd web && bun run test -- features/voice/mic-button.test.tsx` — PASS, 11/11.
- Increment-2 gate, `cd web && bun run typecheck && bun run test` (full suite)
  — PASS, 61 files / 333 tests, 0 failures. (A benign `ECONNREFUSED :3000`
  stack trace appears in stderr from an unrelated pre-existing test's
  fetch-failure path — logged noise, not a failure; exit 0.)
- Format guard (from repo root): `bunx biome check --write
  web/src/features/voice/mic-button.tsx web/src/features/voice/mic-button.test.tsx`
  — "Checked 2 files in 13ms. Fixed 1 file." (cosmetic line-wrap reformat of
  the two new tests in `mic-button.test.tsx`; no logic change). Re-ran the
  focused test after the reformat — still 11/11 passing.

## Files changed
- `web/src/features/voice/mic-button.tsx` — added `aria-live="polite"` +
  `aria-atomic="true"` to the outer wrapper.
- `web/src/features/voice/mic-button.test.tsx` — appended 2 tests.

Confirmed via `git status --short` before staging that only these two files
were committed by this task — other modified files in the tree belong to
concurrently-running sibling SDD tasks (9–13) and were left untouched.

## Commit
`fea5fe6` — `feat(voice): aria-live=polite status region on MicButton (D5)`

## Concerns
None outstanding. This closes Increment 2 (Tasks 9–14); the shared
Increment-2 gate (full `bun run typecheck && bun run test`) confirms no
regression across the a11y/settings/voice suites that share test-setup
fixtures.
