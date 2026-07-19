# Task 9 Report: `stt.worker.ts` — `transcribeInterim` response variant + `TextStreamer` callback in `transcribe()`

Note: this filename was previously used for an unrelated Task 9 from Slice 30b
Phase 7 (transformers.js dep + Vite worker config). That content is
superseded — this is Slice 30b Phase 8, Increment 2's Task 9 (progressive
decode reveal, D6).

## Status: DONE

## Summary

Implemented exactly per brief `/Users/inderjotsingh/ai/.superpowers/sdd/task-9-brief.md`, TDD steps 1-5 in order, no deviations.

## Changes

`/Users/inderjotsingh/ai/web/src/features/voice/stt.worker.ts`:
- Header comment (lines 1-13) updated to mention the TextStreamer callback-accumulation logic as unit-tested, alongside `detectWebGpuDevice`.
- Import line adds `TextStreamer` from `@huggingface/transformers`.
- `SttWorkerResponse` union gains `{ kind: 'transcribeInterim'; id: number; text: string }`.
- New exported pure helper `createInterimAccumulator(): { push(chunk: string): string }` — concatenates delta chunks, returns full running text on each `push()`.
- `transcribe(samples, id)` now takes an `id` param, narrows `asrProcessor?.tokenizer` via a local const, builds a `TextStreamer` (`skip_prompt: true`, `skip_special_tokens: true`, `callback_function` posts `transcribeInterim` with the accumulator's running text), and passes `streamer` into `asrModel.generate(...)`. Final `batch_decode` → `transcribeResult` path is unchanged.
- `self.onmessage`'s `transcribe` branch now passes `msg.id` through to `transcribe()`.

`/Users/inderjotsingh/ai/web/src/features/voice/stt.worker.test.ts`:
- Import line updated to pull in both `createInterimAccumulator` and `detectWebGpuDevice`.
- New `describe('createInterimAccumulator', ...)` block appended verbatim from the brief (2 tests: incremental delta accumulation; empty-string first chunk).

## Gate results

- `cd web && bun run test -- features/voice/stt.worker.test.ts` — failed as expected before implementation (`createInterimAccumulator is not a function`), then passed after: **6/6 tests** (4 pre-existing `detectWebGpuDevice` + 2 new `createInterimAccumulator`).
- `cd web && bun run typecheck` — clean, no errors (confirms tokenizer narrowing and `streamer` generate-option compile against the real `@huggingface/transformers` types).
- `cd web && bun run test` (full suite) — **317/317 tests passed** across 61 files (the `ECONNREFUSED :3000` stack traces in output are pre-existing/unrelated live-server-dependent noise, not failures).
- `bunx biome check --write web/src/features/voice/stt.worker.ts web/src/features/voice/stt.worker.test.ts` — clean, no fixes needed (no format drift).
- Pre-commit `docs-check` hook ran clean as part of the commit (no `docs/architecture.md` change needed — internal API addition within an already-documented subsystem, not a new subsystem).

## Commit

`2d44c58` — `feat(voice): stream transcribeInterim via a TextStreamer callback in stt.worker.ts (D6)`
- Files: `web/src/features/voice/stt.worker.ts`, `web/src/features/voice/stt.worker.test.ts`

## Self-review

- Diff scope matches the brief's `git add` list exactly.
- Left numerous unrelated pre-existing modified files (other task briefs/reports, `.remember/*`) untouched/unstaged — confirmed via `git status` before staging.
- No deviations from the brief's verbatim code snippets.

## Concerns

- None outside scope. Real model/generate/streamer behavior remains live-verify-only per the file's own convention (no WASM/ONNX runtime under happy-dom/Vitest) — consistent with how `detectWebGpuDevice` was isolated in Task 7.
- Downstream consumers (Task 10: `stt-engine.ts` message-protocol plumbing; Task 11/12: `use-voice-input.ts` UI wiring) can now rely on `transcribeInterim` carrying the full running text (monotonic replace semantics, spec §7.1(b)), never a delta.
