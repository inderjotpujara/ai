# Task 12 Report: `use-voice-input.ts` — orchestrator hook

## Status: DONE

## Files
- Created `web/src/features/voice/use-voice-input.ts`
- Created `web/src/features/voice/use-voice-input.test.ts`

## Approach (TDD)
1. Read the task brief (`.superpowers/sdd/task-12-brief.md`) end to end; confirmed the exact
   consumed interfaces (`AudioCapture`/`createAudioCapture`, `SttEngine`/`ModelTier`/
   `createSttEngine`, `createSegmenter`/`Segmenter`) match what Tasks 5/6/8/9/10/11 actually
   shipped by reading `audio-capture.ts`, `stt-engine.ts`, `vad.ts`, `model-tier.ts` directly.
2. Wrote the test file verbatim from the brief (11 `it` blocks covering ready-gating,
   concurrent-gesture guard, both gestures, teardown on disable/unmount, and error
   degradation). Confirmed RED: `Cannot find module './use-voice-input.ts'`.
3. Wrote the implementation verbatim from the brief's Step 3 sample.
4. Ran the tests — 2 of 11 failed. Both were genuine bugs in the brief's own sample code
   (not test bugs), fixed as follows:
   - **Bug A (stopHold flush race):** the `onChunk` handler routed every chunk through an
     async `engine.detectSpeech(chunk).then(isSpeech => segmenter.pushFrame(...))` before
     buffering it, even in hold-to-talk mode. `vad.ts`'s `gated:false` path ignores
     `isSpeech` entirely — the gesture itself is the boundary — so that async hop served no
     purpose there, and a synchronous `stopHold()` → `segmenter.flush()` could run before the
     microtask landed, flushing an empty buffer and silently dropping the last chunk (no
     `transcribe()` call at all). Fixed: hold-mode chunks now call `segmenter.pushFrame(chunk,
     true)` synchronously; tap mode (which genuinely needs the speech/silence classification)
     still goes through `detectSpeech`.
   - **Bug B (mic-permission-denied silently downgraded to 'ready'):** the `capture.start()`
     `.catch()` computed the next status as `readyRef.current ? 'ready' : 'error'`. Since the
     STT engine stays "ready" across a failed capture start, this always resolved to `'ready'`
     — a permission-denied mic left the UI reporting the mic as available. Fixed: always
     `endGesture('error')` on a capture-start rejection.
5. Re-ran — 11/11 pass.
6. Typecheck caught a third, pre-existing issue: `ModelTier` (Task 8/9) is a real string
   *enum*, not a string-literal union, so the brief's `const MODEL: ModelTier =
   'moonshine-base'` doesn't typecheck. Fixed the test to import and use `ModelTier.Base`.
7. Lint (biome) flagged import ordering/formatting and two genuine
   `useExhaustiveDependencies` gaps:
   - `startGesture`'s `useCallback` was missing `deps.createCapture` — added to the deps
     array (no behavior change; deps default to a stable module-level `DEFAULT_DEPS` in
     production).
   - The worker-lifecycle `useEffect` was missing `deps.createEngine`/`opts.model` —
     deliberately NOT added, since the design (stated in the existing code comment) is that a
     model-tier change while `enabled` requires a disable/enable round-trip (Task 15,
     Settings), not a live in-place respawn. Suppressed with a `// biome-ignore
     lint/correctness/useExhaustiveDependencies: ...` comment (matches the project's existing
     convention, e.g. `sessions/index.tsx`), explaining why widening it would be a regression,
     not a fix.

## Gate results
- `cd web && bun run typecheck` — clean.
- `bun run lint:file -- web/src/features/voice/use-voice-input.ts
  web/src/features/voice/use-voice-input.test.ts` (repo-root biome) — clean.
- `cd web && bun run test` — **53 test files / 260 tests passed** (full web suite, not just
  this file — confirms no regression in Tasks 1–11's tests).

## §7.2 requirement -> test mapping (all genuine, not fire-count)
- **(a) Ready-gating:** "a mic press before the engine reports ready is a no-op" — asserts
  `startMock` (AudioCapture.start) is never called while `status === 'loading'`; a real
  no-op, not a buffered/replayed capture (no capture object is even created before
  `readyRef.current` flips).
- **(b) Concurrent-gesture guard:** "rejects an overlapping gesture: a hold press while a
  tap-toggle session is already listening starts no second capture" — asserts
  `startMock` stays at 1 call after the second gesture attempt (not 2). Companion test "a
  second toggleTap() while already listening stops the session instead of starting another"
  asserts `stopMock` fires and `startMock` stays at 1 — proves the guard is a real state
  machine (`gestureRef`), not just an early-return on one code path.
- **(c) Teardown (privacy footgun):** two tests — disabling (`rerender({enabled:false})`)
  asserts `stopMock`/`closeMock` each called exactly once AND `chunkListenerCount() === 0`
  AND a post-teardown `emitChunk` never reaches `onFinal`; a second test asserts the same
  `stopMock`/`closeMock` pair on `unmount()`. Both exercise the real unsubscribe path
  (`unsubRef`), not just a flag flip.
- **(d) Model-load failure:** asserts `readyGate.reject(...)` flips `status` to `'error'`
  with the exact error message, never leaving `status: 'loading'` stuck. A second test
  (capture-start rejection, mic permission denied) is the sibling failure mode and is the one
  that caught Bug B above — genuinely adversarial, not decorative.

## Concerns
- `ready: readyRef.current` is read from a ref during render rather than being its own piece
  of state; it happens to stay consistent because every write to the ref is paired with a
  `setStatus` call in the same tick (forcing a re-render), but a future edit that updates
  `readyRef.current` without also triggering a re-render would silently desync `ready` from
  the rendered value. Low risk today, worth a comment or derivation from `status` if touched
  again.
- Interim text is a fixed `'…'` placeholder (per spec: "busy signal, not word-streaming") —
  confirmed intentional from the task description, not tested explicitly beyond the two
  gesture-flow tests exercising `onFinal`; no dedicated `onInterim` assertion in this test
  file (brief didn't include one). Flagging for Task 13's adversarial pass in case it wants
  one.

## Commit
`a3b3b6d feat(voice): add useVoiceInput orchestrator hook (both gestures, ready-gating, teardown)`
