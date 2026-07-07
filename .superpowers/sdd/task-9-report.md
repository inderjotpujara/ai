# Task 9 report: captureFromMic (tap-to-toggle + silencedetect auto-stop)

Note: this filename was previously reused for an earlier, unrelated Task 9
(Slice 26 altruntime-download live-verify). That content is superseded here —
this is the Slice 29 voice-input CLI Task 9 (mic capture control logic).

## Status: DONE

## What shipped

`src/voice/capture.ts` gained:
- `MicSession` / `MicIo` types (as specified in the brief).
- `MAX_CAPTURE_SAMPLES` (exported module constant = `MAX_CAPTURE_SECONDS (60) * 16000`) — the
  length-cap addition beyond the brief.
- `hasEnergy(samples)` — peak-amplitude check (> 0.005) to distinguish real audio from
  TCC-denied silence.
- `captureFromMic(cfg, io)` — the control-logic function. `cfg` is accepted (interface
  parity with the rest of the module / future real `MicIo`) but unused today, hence
  `_cfg` to signal that explicitly.

`tests/voice/capture-mic.test.ts` (new) — 3 tests, all using the brief's injected `fakeIo`
(no real ffmpeg/mic/TTY):
1. Brief test 1 — accumulates frames, stops on `silenceSignaled` resolving.
2. Brief test 2 — all-zero capture → `VoiceError` matching `/microphone/i` (the
   mic-permission hint).
3. New — feeds ~44 chunks of 4000 samples (well past `MAX_CAPTURE_SAMPLES` = 960000,
   never signals silence) and asserts the returned `samples.length` is
   `>= MAX_CAPTURE_SAMPLES` and `< MAX_CAPTURE_SAMPLES + chunkSize` (bounded to within one
   chunk of the cap, since the pump loop can only check the running total after each frame).

## Control-flow design

Single control `Promise<void>` wraps the whole "wait until recording is over" phase;
resolution happens through two idempotent choke points so no code path can settle it twice
or leave it hanging:

- `settleOk()` / `settleErr(err)` — each guarded by a `settled` flag. First caller wins;
  every other caller is a no-op. Both also call `off()` (unsubscribe from `io.onKey`)
  exactly once, inside the guard.
- `stopSession()` — guarded by a separate `stopped` flag so `session.stop()` is invoked at
  most once no matter how many triggers fire.
- `finish()` — the single funnel for every "recording is over, not cancelled" trigger
  (silence detected, manual second space/enter, or the length-cap pump ending). It always
  does `await stopSession()` **then** `await framesDone` **then** `settleOk()` — i.e. it
  never resolves the outer promise until the frame-accumulation loop has fully drained into
  `chunks`.

Three triggers, all funneled through `finish()`, are wired only *after* `io.start()`
resolves (so `session`/`framesDone` are guaranteed assigned before any of them can fire):
- `session.silenceSignaled.then(finish)`
- `framesDone.then(finish)` (this is what makes the length-cap stop work — see below)
- the manual second `space`/`enter` keypress → `await finish()` directly in `handleKey`

`ctrl-c` bypasses `finish()` entirely (it doesn't wait for `framesDone` — cancellation
should be immediate, and the accumulated `chunks` are discarded anyway): it calls
`stopSession()` then `settleErr(new VoiceError('cancelled'))` straight away.

## Avoiding the double-resolve / self-deadlock trap

The brief's sample implementation has a shape where `pumpFrames`'s cap-check could
plausibly want to call the same "we're done" logic that also awaits the pump promise
itself — which would deadlock (a promise can't be awaited by its own not-yet-returned
executor). I avoided this by keeping `pumpFrames` cap-handling purely local: it just
`break`s out of its own `for await` loop when `sampleCount >= MAX_CAPTURE_SAMPLES` (and
prints the notice) and returns normally. The *decision* to settle the outer promise in
response to that is made **outside** `pumpFrames`, via `framesDone.then(finish)`, which is
only attached after `pumpFrames(started)` has already been invoked and its promise handle
captured — so `finish()` awaiting `framesDone` there is always awaiting an independent,
already-in-flight promise, never itself.

Both `settleOk`/`settleErr` and `stopSession` are idempotent by flag, so it's safe for
`finish()` to be invoked concurrently from more than one trigger (e.g. in the "stop on
silence" test, `silenceSignaled` resolving and `framesDone` resolving both queue a call to
`finish()` in the same microtask window) — only the first full run mutates state; the rest
are no-ops. This also means the outer promise only ever calls `resolve()`/`reject()` once,
satisfying the "resolves exactly once" requirement.

Because `finish()` always awaits `framesDone` before calling `settleOk()`, `chunks` is
guaranteed fully populated (the `for await` loop has run to completion or to its cap break)
before the function moves on to concatenate samples and run the energy check — no race
where the caller reads a still-filling buffer.

## Cap implementation

- `MAX_CAPTURE_SECONDS = 60` module constant (not threaded through `VoiceConfig`, per the
  task instruction — a later slice can promote it to config if needed).
- `MAX_CAPTURE_SAMPLES = MAX_CAPTURE_SECONDS * 16000` is exported so the test can assert
  against the exact boundary rather than a hardcoded magic number.
- `pumpFrames` tracks `sampleCount` as frames arrive and breaks the loop (plus
  `io.print('reached max capture length')`) as soon as the running total reaches the cap.
  This bounds the buffer even for the fake io's synchronous-array generator, which has no
  real "stop the source" semantics — the real `MicIo` (Task 11) will additionally have
  `session.stop()` actually kill the ffmpeg process, but the client-side accounting here is
  what provides the hard guarantee independent of the io implementation.
- The bound is "≈ cap, not exact": the loop can only check after pushing a whole frame, so
  the final length can overshoot by up to one frame's worth of samples. The new test uses
  small (4000-sample) synthetic frames and asserts the overshoot window explicitly
  (`< MAX_CAPTURE_SAMPLES + chunkSize`).

## TDD RED → GREEN

1. Wrote `tests/voice/capture-mic.test.ts` with all 3 tests (brief's 2 + the cap test),
   importing not-yet-exported `MAX_CAPTURE_SAMPLES` and `captureFromMic`.
2. Ran `bun test tests/voice/capture-mic.test.ts` → RED: `SyntaxError: Export named
   'MAX_CAPTURE_SAMPLES' not found in module '.../src/voice/capture.ts'.` (confirms the
   test file is wired to the real module, not a stub).
3. Appended the implementation described above to `src/voice/capture.ts`.
4. Ran `bun test tests/voice/capture-mic.test.ts` → GREEN: `3 pass, 0 fail, 4 expect()
   calls`.
5. `bun run typecheck` → clean (`tsc --noEmit`, no output).
6. `bun test tests/voice/` (full voice suite) → `24 pass, 0 fail` across 8 files — no
   regressions in the sibling voice tests (model, capture-file, transcribe*, spans, types,
   setup-voice).
7. `bun run lint:file -- "src/voice/capture.ts" "tests/voice/capture-mic.test.ts"` →
   initially failed on Biome formatting only (line-wrapping of the new function signature,
   ternary, and destructure calls — no logic/rule violations); ran
   `bunx biome format --write` on both files, then lint re-ran clean.
8. `bun run docs:check` → passes unchanged (`src/voice` subsystem is already documented in
   `docs/architecture.md` from Task 8; this task adds a function to an existing documented
   file, not a new subsystem — doc-surface work for the mic-capture control flow is Task 12
   per the SDD ledger).

## Deviations from the brief

- `hasEnergy` iterates with `for (const v of samples)` instead of an indexed `for` loop,
  because `tsconfig.json` has `noUncheckedIndexedAccess: true` — indexed access
  (`samples[i]`) would type as `number | undefined` and fail `tsc --noEmit`. Iterating
  directly over the `Float32Array` sidesteps that with identical behavior.
- `cfg` parameter renamed to `_cfg` (still typed `VoiceConfig`) since it's genuinely unused
  by the control logic in this task — it's kept in the signature for interface parity with
  `captureFromFile` and because the real `MicIo`/CLI wiring in Task 11 will likely thread
  `cfg.ffmpeg` etc. through the io construction, not through this function.
- Added the `MAX_CAPTURE_SAMPLES` export and the length-cap guard end-to-end (pump-loop
  tracking + break + notice print + dedicated test), per the explicit Task-9 instruction
  addressing the Task-7 review Minor.

## Self-review

- Checked for orphaned promises: `started.silenceSignaled.then(finish).catch(() => {})`
  and `framesDone.then(finish).catch(() => {})` both have `.catch` no-ops so a rejection
  from either (e.g. if a future real `MicIo` throws inside the frame generator) can't
  produce an unhandled-rejection warning; `finish()`'s own guard makes a subsequent
  `settleErr` call (if the frame loop later throws) a no-op once already settled by
  `settleOk`. This is an intentional bias toward "we have something, return it" over
  "surface every downstream error once recording has already stopped" — worth reconfirming
  during Task 13's live-verify pass with the real ffmpeg-backed `MicIo`.
- `handleKey`'s callback registered as `(key) => { void handleKey(key); }` returns a
  `Promise<void>` from an async function assigned to a callback typed `(key) => void`;
  TypeScript's structural typing permits this (a caller expecting `void` accepts any actual
  return value), and the explicit `void` keeps Biome's floating-promise-shaped lint quiet —
  confirmed via `bun run lint:file`.
- Confirmed no real ffmpeg/mic/TTY is touched anywhere in the test file — everything drives
  through the injected `MicIo` fake from the brief plus the cap test's larger synthetic
  fake, both fully synchronous/deterministic (no timers, no real audio hardware).

## Files changed

- `src/voice/capture.ts` — added `MicSession`, `MicIo`, `MAX_CAPTURE_SAMPLES`, `hasEnergy`,
  `captureFromMic`.
- `tests/voice/capture-mic.test.ts` — new, 3 tests.

## Verification commands (all green)

```
bun test tests/voice/capture-mic.test.ts   # 3 pass
bun run typecheck                          # tsc --noEmit clean
bun test tests/voice/                      # 24 pass across 8 files
bun run lint:file -- "src/voice/capture.ts" "tests/voice/capture-mic.test.ts"  # clean
bun run docs:check                         # passes unchanged
```

## Concerns / follow-ups for later tasks

- Real `MicIo` (Task 11) must ensure `session.stop()` actually terminates the ffmpeg
  subprocess promptly so `framesDone` in the "manual stop" and "cap reached" paths resolves
  quickly in practice (the fake io's `stop()` is a no-op, so this task's tests don't
  exercise that timing).
- The `.catch(() => {})` swallow on the two `.then(finish)` chains is a deliberate
  "best-effort" choice; Task 13's live-verify should confirm no real ffmpeg-stderr-parsing
  error gets silently dropped in a way that leaves the user without a useful message.

## Commit

- See parent report — commit SHA and subject reported by the calling task.
