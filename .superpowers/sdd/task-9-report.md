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

---

## Review-fix pass (2026-07-07): hardened mic-capture error paths

The self-review's own "Concerns / follow-ups" flagged exactly what this pass fixed: the
bare `.catch(() => {})` swallows and the unguarded `stopSession()` were confirmed as real
gaps by an adversarial review ahead of Task 11 (real ffmpeg wiring). Two Important
findings + two Minors, all fixed in `src/voice/capture.ts` (`captureFromMic` only —
`captureFromFile` untouched).

### Important 1 — `stopSession()` had no error handling

**Failure scenario:** once Task 11 wires a real ffmpeg-backed `MicSession`, `session.stop()`
killing an already-exited process can throw (e.g. `ESRCH`). That rejection would propagate
out of `stopSession()` → out of `finish()` (called from the silence/frames/manual-stop
paths) and out of the `ctrl-c` branch of `handleKey`. Since `handleKey` was invoked as
`void handleKey(key)` with no `.catch`, that became an **unhandled promise rejection**
(can crash the process) and — because the rejection happened before `settleOk`/`settleErr`
ran — the outer control promise never settles, hanging `captureFromMic` forever.

**Fix:** wrapped `await session?.stop()` inside `stopSession()` in try/catch. A stop
failure is now logged via `io.print(\`mic stop failed: ${errMessage(err)}\`)` and
swallowed — `stopSession()` always resolves normally, so every caller (`finish()`, the
`ctrl-c` branch) can rely on it never throwing.

**Single-resolve preserved:** `stopSession()` no longer throws at all, so it can't
interfere with the `settled`/`stopped` guards; `stopped = true` is still set exactly once
inside the function before the try, so `session.stop()` is still called at most once no
matter how many triggers race.

### Important 2 — `.catch(() => {})` on `silenceSignaled`/`framesDone` masked real errors

**Failure scenario:** if the real frame async-iterator throws mid-stream (device
disconnected, ffmpeg not found, bad device) — a genuine capture error — the old bare
`.catch(() => {})` on both `started.silenceSignaled.then(finish).catch(...)` and
`framesDone.then(finish).catch(...)` silently dropped it. Because `finish()` was never
called (the `.then` is skipped when the awaited promise rejects) the outer promise then
hung forever; if it somehow later reached the empty/no-energy check, the caller would see
the misleading "grant Microphone access" hint instead of the actual cause (e.g. "device
disconnected").

**Fix:** added a shared `fail(context, err)` helper (guarded through `settleErr`, which is
itself guarded by the `settled` flag) that logs `` `${context}: ${message}` `` via
`io.print` and calls
`settleErr(new VoiceError('microphone capture failed', errMessage(err)))` — the real error
message lands in `VoiceError.hint`, distinct from the empty/no-energy hint text. Wired to
both chains:
- `started.silenceSignaled.then(finish).catch((err) => fail('silence detection failed', err))`
- `framesDone.then(finish).catch((err) => fail('frame capture failed', err))`

Also added a `.catch` to the `io.onKey` dispatch — previously `void handleKey(key)`
discarded the returned promise with no error path at all. Now:
```ts
const off = io.onKey((key) => {
  void handleKey(key).catch((err: unknown) => {
    fail('mic key handler failed', err);
  });
});
```
This is the safety net for the one remaining throw path: if a user manually presses a
second space/enter while `framesDone` has *already* rejected, `finish()`'s
`await framesDone` re-throws inside `handleKey`, which now routes to `fail` instead of
becoming an unhandled rejection.

**Single-resolve preserved:** `fail()` always terminates in `settleErr`, which is a no-op
once `settled` is true. In the race above, by the time the manual keypress's `finish()`
call reaches its `await framesDone`, the `framesDone.then(finish).catch(fail)` chain has
almost always already fired `fail` → `settleErr` first (settling the promise), so the
second `fail` call from the `handleKey` dispatch catch is already a no-op. Even in the
theoretical tightest race, both paths funnel through the same idempotent `settleErr`, so
the control promise still resolves/rejects exactly once.

Confirmed the empty/no-energy path is unchanged and still correct: that check only runs
*after* the control promise resolves via `settleOk()` (silence auto-stop, cap reached, or
manual stop with zero/silent samples) — it's not reachable from any of the new `fail()`
paths, which always reject via `settleErr` instead.

### Minor — hardcoded `16000` → `MIC_SAMPLE_RATE`

The mic capture's final `return { samples, sampleRate: 16000 }` now reads
`return { samples, sampleRate: MIC_SAMPLE_RATE }`, reusing the existing module constant.
(`captureFromFile`'s own `sampleRate: 16000` was left untouched per the review's explicit
scope — that function wasn't part of this pass.)

### New tests (`tests/voice/capture-mic.test.ts`)

Extended the fake-io helpers (kept hermetic — no real ffmpeg/mic/TTY):
- `fakeIo` gained a generic `pressKey(k)` alongside the existing `pressSpace()`.
- New `liveFakeIo(chunks)`: a frame generator that yields the given chunks then blocks on
  an internal deferred promise, which only resolves when `session.stop()` is called (and
  `silenceSignaled` never resolves) — simulating a real ffmpeg pipe that only ends when the
  process is killed, so only a manual stop can conclude the capture. This was necessary
  because the original `fakeIo`'s finite in-memory generator completes on its own,
  which would make a "manual stop" test indistinguishable from the frames-drain path.
- New `throwingFakeIo(firstChunk, errorMessage)`: yields one chunk then throws inside the
  async generator, to exercise Important 2's fix.

Three new tests added:
1. **`ctrl-c cancels the capture with a VoiceError`** — fires `ctrl-c` with no prior
   `space`; asserts the returned promise rejects with a `VoiceError` matching `/cancelled/i`.
2. **`a manual second space stops capture and returns the accumulated samples`** — uses
   `liveFakeIo`; presses space to start, yields a microtask so `pumpFrames` starts draining
   the live stream, then presses space again to manually stop; asserts the resolved
   `frames.samples.length` equals the pushed chunk's length (800), proving `stopSession()`
   → generator-close → `framesDone` → `settleOk()` all still complete correctly through the
   fixed code path.
3. **`surfaces the real error (not the mic-permission hint) when the frame stream throws
   mid-iteration`** — uses `throwingFakeIo` with message `'device disconnected'`; asserts
   the rejection is a `VoiceError` whose `.hint` contains `'device disconnected'` and does
   **not** match `/grant Microphone access/i`, directly proving Important 2's fix routes the
   real cause instead of masking it with the permission hint.

### Verification commands (all green)

```
bun test tests/voice/capture-mic.test.ts
# bun test v1.3.11
#  6 pass
#  0 fail
#  10 expect() calls
# Ran 6 tests across 1 file. [28.00ms]

bun test tests/voice/
# bun test v1.3.11
#  27 pass
#  0 fail
#  44 expect() calls
# Ran 27 tests across 8 files. [119.00ms]

bun run typecheck
# $ tsc --noEmit
# (clean, no output)
```

### Files changed in this pass

- `src/voice/capture.ts` — `stopSession()` try/catch, new `errMessage()`/`fail()` helpers,
  `.catch` wiring on `silenceSignaled`/`framesDone`/`handleKey` dispatch,
  `MIC_SAMPLE_RATE` reuse in the mic return statement. `captureFromFile` untouched.
- `tests/voice/capture-mic.test.ts` — `pressKey` added to `fakeIo`, new `liveFakeIo` and
  `throwingFakeIo` helpers, 3 new tests (6 total, up from 3).
