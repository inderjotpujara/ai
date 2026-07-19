# Task 10 Report — stt-engine.ts forwards transcribeInterim via id-correlated onInterim (D6)

## Status: Complete

## What was done
Followed TDD per the brief exactly:

1. Appended the 3 brief-specified tests to `web/src/features/voice/stt-engine.test.ts`
   (after "transcribe() resolves with the matching response by request id"):
   - `transcribe() forwards transcribeInterim messages to an optional onInterim callback, id-correlated`
   - `does not cross-deliver transcribeInterim between two concurrent transcribe() calls (different ids)`
   - `stops delivering to onInterim once its request has settled (no leaked listener)`
2. Ran the suite — 2 of the 3 new tests failed as expected (mock never invoked because the
   second `onInterim` argument was silently ignored and `transcribeInterim` was unhandled by
   `worker.onmessage`); the "no leak" test trivially passed since `onInterim` was never called at all yet.
3. Implemented in `web/src/features/voice/stt-engine.ts` exactly per the brief:
   - Widened `SttEngine.transcribe` type to `transcribe(frames, onInterim?: (text: string) => void): Promise<string>`.
   - Added `interimListeners = new Map<number, (text: string) => void>()` next to `pendingTranscribe`, with the doc comment from the brief explaining the Map (not Set) choice and the no-cross-talk requirement.
   - Added a `transcribeInterim` branch in `worker.onmessage` (between `detectSpeechResult` and `transcribeResult`) that looks up the listener by `msg.id` and invokes it with `msg.text`.
   - Cleared `interimListeners.delete(msg.id)` in both the `transcribeResult` and the id-scoped `error` branches.
   - Updated `transcribe()` to accept the optional `onInterim` param and `interimListeners.set(id, onInterim)` when provided.
   - Updated `close()` to `interimListeners.clear()` alongside the other maps.
4. Re-ran the target test file — all 16 tests (13 pre-existing + 3 new) passed.
5. Ran `bun run typecheck` — clean.
6. Ran the full web test suite (`bun run test`) — 320/320 passed (61 files); one unrelated `ECONNREFUSED` stack trace appeared in the output from an unrelated live/e2e check (not a test failure, unrelated to this change).
7. Ran `bunx biome check --write` on the two changed files from `/Users/inderjotsingh/ai` — reformatted `stt-engine.test.ts` (line-wrapped the new long test lines to fit biome's width); re-ran the target test + typecheck after the reformat to confirm nothing broke.
8. Committed only the two target files (`web/src/features/voice/stt-engine.ts`, `web/src/features/voice/stt-engine.test.ts`) — other unrelated modified/untracked files in the repo (from concurrent task work on other Task N files) were left untouched/unstaged.

## Commit
`d0708be` — `feat(voice): stt-engine.ts forwards id-correlated transcribeInterim via onInterim (D6)`

## Test summary
- `stt-engine.test.ts`: 16/16 passed (3 new: interim forwarding, no cross-talk between concurrent ids, no listener leak after settle).
- Full web suite: 320/320 passed, typecheck clean.

## Files touched
- `/Users/inderjotsingh/ai/web/src/features/voice/stt-engine.ts`
- `/Users/inderjotsingh/ai/web/src/features/voice/stt-engine.test.ts`

## Concerns
None. Implementation matches the brief verbatim (type widening, Map-based per-id correlation, cleanup on settle/error/close, no cross-talk). Biome's auto-format only touched line-wrapping in the test file, no semantic change. Note: this path previously held a stale report for an unrelated earlier "Task 10" (vad.ts, from a prior renumbering pass) — it has been overwritten with this task's actual content.
