### Task 14 report (Slice 30b Phase 7): `waveform.tsx` + `mic-button.tsx` — composer-mounted voice affordance

> Note: this file previously held a report for an unrelated "Task 14" from an
> earlier phase (Phase 5's builders-wizard task, under a different numbering
> scheme). That content is superseded here per this task's explicit
> instruction to write the Phase-7 voice-affordance report to this exact
> path; the prior content remains in git history if needed.

**Status:** DONE — all steps in the brief completed, gate green, committed.

**Files created:**
- `web/src/features/voice/waveform.tsx` — `Waveform({ level })`: single CSS-width-driven bar, clamps `level` to [0,1], `data-testid="voice-waveform"`.
- `web/src/features/voice/waveform.test.tsx` — 3 tests (50%, clamp-above-1→100%, clamp-below-0→0%).
- `web/src/features/voice/mic-button.tsx` — `MicButton({ onFinal, onInterim })`: reads `isVoiceInputEnabled()`/`voiceModelTier()` from `../settings/index.tsx`, calls `useVoiceInput`. Renders `null` when disabled. Two separate buttons: `mic-hold-button` (pointerdown/up + keydown/up on Space/Enter, ignoring key-repeat; `onPointerLeave` also fires `stopHold` as a best-effort safety net if the pointer leaves mid-hold) and `mic-tap-toggle-button` (click → `toggleTap`). Renders `Waveform` while `status === 'listening'`. Degrade states (D9): `loading` → disabled hold button + "Loading voice model…"; `error` → both buttons disabled + `role="alert"` showing `voice.error`; WebGPU-absent → non-blocking "(CPU mode)" hint (`'gpu' in navigator` check) shown whenever not disabled.
- `web/src/features/voice/mic-button.test.tsx` — 8 tests per brief (disabled-when-off, loading state, error state, hold pointerdown/up, hold keydown/up with repeat ignored, tap click, waveform-while-listening, CPU-mode hint).

**Deviations from the brief's literal sample code** (both required to pass biome lint; verified first against the actual `use-voice-input.ts`/`settings/index.tsx` contracts, which the brief's interfaces matched exactly):
1. Reformatted the `configuredSilenceMs()` optional-chain line — cosmetic, biome format-only.
2. Dropped `role="group" aria-label="Voice input"` from the outer `<div data-testid="mic-button">`. Biome's `useAriaPropsSupportedByRole`/`useSemanticElements` a11y rules rejected both a plain `<div>` carrying `aria-label` and `role="group"` (biome wants `<fieldset>`, wrong semantics for this non-form container). Left it a plain test-id wrapper; the two buttons already carry their own `aria-label`s so no accessible-name coverage was lost.

**TDD evidence:**
- RED confirmed first: `cd web && bun run test -- waveform.test.tsx mic-button.test.tsx` → both files failed with "Failed to resolve import" (module didn't exist yet).
- GREEN: same command → 2 files, 11/11 tests passed (3 waveform + 8 mic-button).

**Gate:**
- `cd web && bun run typecheck` — clean.
- `cd web && bun run test` (full suite) — 55 test files, 279 tests, all passed. (A benign `ECONNREFUSED :3000` stack trace appears in stderr from an unrelated pre-existing test's fetch-failure path — a logged trace, not a failure; exit 0.)
- `bun run lint:file -- <the 4 new files>` (biome) — caught 1 a11y error + 1 format nit on first run; fixed (see deviations above); re-run clean (0 errors, 0 warnings).
- `bun run lint` (repo-root, full) — exit 0; 18 pre-existing warnings in unrelated files (untouched by this task), none in the new voice files.

**Files changed:** Created `web/src/features/voice/waveform.tsx`, `waveform.test.tsx`, `mic-button.tsx`, `mic-button.test.tsx`. No other files touched (confirmed via `git status --short` before staging — only these 4 were added by this task; other modified files in the tree belong to concurrently-running sibling SDD tasks).

**Self-review:**
- Keyboard operability: `mic-hold-button` is a real `<button>` (not a div-with-handlers), so it's natively focusable/keyboard-operable; Space/Enter keydown/keyup drive `startHold`/`stopHold` with `event.preventDefault()` to stop the browser's default button-activation-on-keyup double-fire, and `event.repeat` is checked so held-down auto-repeat doesn't re-invoke `startHold`.
- Degrade-never-crashes: `error` status renders inline via `role="alert"` and disables both buttons rather than throwing; `hasWebGpu()` guards `navigator` defensively (`typeof navigator !== 'undefined'`) so the WebGPU-absent test's `vi.stubGlobal('navigator', {})` (which removes `navigator.gpu` entirely) degrades to the CPU-mode hint instead of crashing.
- `isVoiceInputEnabled()`/`voiceModelTier()`/`useVoiceInput` are called unconditionally before the `if (!enabled) return null` check (React hooks-rules constraint — `useVoiceInput` can't be called conditionally), matching how `useVoiceInput` itself is designed to no-op/stay `'disabled'` when `opts.enabled` is false.
- Two fully separate, clearly labeled affordances (no press-duration disambiguation) per the locked D2 decision.

**Concerns:** None blocking. Flagging for Task 15 (composer wiring): the outer `mic-button` div carries no group-level `aria-label` of its own (see deviation #2) — if a wrapping landmark label is desired at the composer level, add it at that call site rather than reintroducing the rejected a11y pattern here.

**Commit:** `6555712` — `feat(voice): add MicButton (hold + tap-toggle affordances) and Waveform`
