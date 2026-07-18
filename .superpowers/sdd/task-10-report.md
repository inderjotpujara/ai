# Task 10 Report — `vad.ts` pure segmenter, hold-to-talk (non-gated) mode

## Status: DONE

## What was built
- `web/src/features/voice/vad.ts` — pure segmentation state machine (spec §7.1), no React/DOM/worker deps.
  - `SegmenterOpts` / `Segmenter` / `createSegmenter()` exported verbatim per the locked interface (consumed by Task 11 in the same file and Task 12's `use-voice-input.ts`).
  - Hold-to-talk (`gated: false`) path (this task's scope): every pushed frame buffers unconditionally, `isSpeech` ignored entirely; `flush()` concatenates the full buffer into one contiguous `Float32Array` (total-length allocation + offset copies via `.set()`, not per-frame push/misorder-prone concat) and emits a `VoiceFrames` (`sampleRate: 16000`) to subscribers; empty buffer → no phantom emit.
  - `reset()` clears buffer/state without emitting.
  - `onSegment()` returns an unsubscribe closure.
  - Gated (tap-to-toggle) branch is structurally present (silence-accumulation + trailing-silence trim on close) but its behavior/tests are Task 11's responsibility — untested by this task, deliberately out of scope per the brief.
- `web/src/features/voice/vad.test.ts` — the 7 hold-to-talk tests from the brief.

## §7.1 correctness verification
- Tests "flush() emits exactly one segment concatenating every buffered chunk in push order" and "does not truncate a frame pushed immediately before flush()" directly assert the full sample sequence (`Array.from(frames.samples)`) equals the exact ordered concatenation of every pushed chunk — no drops, no reordering, no truncation of the release-boundary residual.
- `concat()` allocates the exact total length up front and copies each chunk at its running offset — correct by construction, not accidentally correct via naive array-of-arrays coercion.

## Bug found + fixed in the brief's verbatim tests
The brief's two content-assertion tests compared `Array.from(Float32Array)` values against float64 literals via `toEqual` (e.g. expecting exactly `0.1`), which fails because `Float32Array` stores `0.1` as `0.10000000149011612` — a float32-precision artifact, not an implementation defect. RED run confirmed this (2 failures, diffs showing float32-rounded vs float64-literal values on an otherwise-correct implementation). Fixed by round-tripping the *expected* arrays through `Float32Array` too (`Array.from(new Float32Array([0.1, ...]))`), preserving the strict order/no-drop assertion while eliminating the precision false-negative.

## Self-review (per task ask)
- flush() emits ALL pushed frames in order: yes — verified via exact-sequence assertions above, and via `concat()`'s total-length/offset-copy construction.
- Empty flush(): no emit (`buffer.length === 0` short-circuits before touching listeners) — test 4 covers.
- reset(): clears buffer + `inSegment` + silence accumulator, no emit — test 5 covers.
- Double flush(): second flush is a no-op since `emit()` already drained the buffer to `[]` — test 6 covers.
- Unsubscribe: `onSegment()`'s returned closure removes the callback from the `Set` — test 7 covers.

## Gate results
- `cd web && bun run typecheck` — clean (fixed 2 `noUncheckedIndexedAccess` findings: a `buffer[i]` narrowing in `closeSustainedSilence()`, and test-side `as VoiceFrames` casts instead of non-null assertions, to satisfy both TS strictness and biome's `noNonNullAssertion` rule).
- `bun run lint:file -- web/src/features/voice/vad.ts web/src/features/voice/vad.test.ts` — clean (0 errors, 0 warnings after a biome format pass + assertion-style fix).
- `bun run lint` (full repo, root) — exit 0; 18 pre-existing warnings in unrelated files (not touched by this task).
- `cd web && bun run test -- vad.test.ts` — 7/7 passed.
- `cd web && bun run test` (full web suite) — 52 files / 242 tests passed (one unrelated stderr ECONNREFUSED:3000 noise from a pre-existing test, not a failure).

## Docs
No `docs/architecture.md` change needed — `web/src/features/voice` is an already-documented subsystem (Tasks 3/7/9); pre-commit `docs:check` hook passed clean.

## Commit
`8aec7df` — `feat(voice): add createSegmenter pure state machine (hold-to-talk mode)`

## Concerns / handoff notes for Task 11 (gated/tap-to-toggle)
- The gated branch's silence-trim logic (`closeSustainedSilence`) is implemented but **not exercised by any test in this task** — Task 11 must write its own tests against it (multi-segment close/reopen cycles, trailing-silence trim-back correctness, `silenceMs` threshold edge cases). Treat it as unverified until Task 11's tests land.
- `chunkDurationMs()`'s `frameMs` fallback (zero-length "heartbeat" chunk) is also unexercised here — worth a Task 11/13 test if the worker ever pushes zero-length chunks in gated mode.
