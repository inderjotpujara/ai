# Task 11 Report: `use-voice-input.ts` — wire real streamed interim text (Slice 30b Phase 8, D6)

## Status: DONE

## What was done

Followed TDD exactly per the brief (`/Users/inderjotsingh/ai/.superpowers/sdd/task-11-brief.md`):

1. Confirmed interfaces first:
   - `web/src/features/voice/stt-engine.ts`: `SttEngine.transcribe(frames, onInterim?)` where `onInterim: (text: string) => void` receives the full running text, id-correlated via the `interimListeners` map (Task 10, commit d0708be, already landed).
   - `web/src/features/voice/use-voice-input.ts` lines 161–196 (pre-change): the `onSegment` callback hardcoded `setInterim('…')` and called `engine.transcribe(frames)` with a single argument (no `onInterim`).

2. Appended the brief's 3 tests verbatim to `web/src/features/voice/use-voice-input.test.ts` (inside `describe('useVoiceInput', ...)`, right before the `'when enabled is false...'` test):
   - hold-to-talk streams real interim text, replacing `'…'`.
   - VAD tap-to-toggle streams real interim text too.
   - monotonic-replace property test (§7.1 b) — every `onInterim` message is a full-text replace, never a shorter fragment.

3. Ran tests — all 3 new tests failed as expected (`interim` stuck at `'…'`, `capturedOnInterim` never invoked because `transcribe` was called with one argument). Confirmed the red state matches the brief's expectation.

4. Applied the minimal implementation change to the `onSegment` callback in `use-voice-input.ts`: `engine.transcribe(frames)` → `engine.transcribe(frames, (text) => setInterim(text))`, with the brief's exact comment noting the three adversarial guards (dropped-for-invalidated-segmenter, back-to-back gesture isolation, final-wins-over-late-interim) are deliberately deferred to Task 12. The `.then()`/`.catch()`/`.finally()` chain for `onFinal`/`status`/`validSegmentersRef` cleanup is unchanged.

5. Verified green:
   - `cd web && bun run test -- features/voice/use-voice-input.test.ts` → 20/20 passed (17 pre-existing + 3 new).
   - `cd web && bun run test` (full suite) → 323/323 passed across 61 test files (some `ECONNREFUSED` stderr noise from an unrelated pre-existing test that intentionally exercises connection-failure handling — not a failure, all suites reported passed).
   - `cd web && bun run typecheck` → clean, no errors.

6. Format guard (from `/Users/inderjotsingh/ai`): `bunx biome check --write web/src/features/voice/use-voice-input.ts web/src/features/voice/use-voice-input.test.ts` → "Checked 2 files, Fixed 1 file" (whitespace-only fix in the test file: removed an extra space in `s.startsWith('')`). Re-ran tests + typecheck after the fix — both still green.

7. Committed on branch `slice-30b-phase8-polish-a11y`:
   - `8012726 feat(voice): wire real streamed interim text into use-voice-input.ts (D6)`
   - Pre-commit `docs-check` hook passed (no `architecture.md` update needed — this wires an existing Task 10 interface into an existing hook, no new subsystem or module boundary).
   - Only the two scoped files were staged/committed (`use-voice-input.ts`, `use-voice-input.test.ts`); several `.superpowers/sdd/task-N-*.md` files showed as modified in `git status` but were pre-existing/unrelated to this task and left untouched.

## Files changed
- `/Users/inderjotsingh/ai/web/src/features/voice/use-voice-input.ts` — `onSegment` callback now passes an `onInterim` callback to `engine.transcribe()` that calls `setInterim(text)` with the real streamed text, for both gestures.
- `/Users/inderjotsingh/ai/web/src/features/voice/use-voice-input.test.ts` — 3 new tests appended.

## Concerns / notes
- None blocking. This is intentionally the naive wiring only — no adversarial guards were added, correctly scoped out to Task 12 per the brief (dropped-for-invalidated-segmenter, back-to-back gesture isolation, final-wins-over-late-interim).
- Note for whoever reads the ledger later: this repo's Task numbering was reused across Slice 30b phases — an earlier "Task 11" (Phase 7, vad.ts tap-to-toggle) previously occupied this report file's path. That content has been fully replaced by this report; the Phase-7 work is preserved in its own commits (`1bdb50a`, `560f076`) and is unaffected by this overwrite.
