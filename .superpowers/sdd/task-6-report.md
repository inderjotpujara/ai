# Task 6 Report: createAudioCapture + downsample-worklet + setup.ts stubs

## Status: DONE

## What was built
- `web/src/test/setup.ts`: appended `FakeMediaStreamTrack`, `FakeMediaStream`,
  `FakeAudioWorklet` (internal), `FakeAudioWorkletNode`, `FakeAudioContext`,
  plus getters `getLastAudioWorkletNode`/`getLastAudioContext`/
  `getLastGetUserMediaConstraints`/`getLastMediaStream`, and a `beforeEach`
  that resets the "last" refs and stubs `navigator.mediaDevices.getUserMedia`,
  `AudioContext`, `AudioWorkletNode` globals — verbatim per the brief.
- `web/src/features/voice/audio-capture.ts`: appended `AudioCapture` type,
  `rms()` helper, and `createAudioCapture()`. `start()` calls
  `getUserMedia({audio:{echoCancellation,noiseSuppression,autoGainControl}})`,
  opens an `AudioContext`, loads the worklet module
  (`new URL('./downsample-worklet.ts', import.meta.url)`), creates the
  `MediaStreamAudioSourceNode`, constructs the `AudioWorkletNode` (passing
  `ctx.sampleRate` via `processorOptions.inputRate`), wires `port.onmessage`
  to fan out chunks to `onChunk` subscribers and a computed RMS to `onLevel`
  subscribers, then connects source→node. `stop()` stops every track on the
  captured `MediaStream`, disconnects source/node, awaits `ctx.close()`, then
  clears all internal refs and flips `active` false. `onChunk`/`onLevel`
  return unsubscribe closures backed by `Set.delete`.
- `web/src/features/voice/downsample-worklet.ts` (new): ambient
  `AudioWorkletProcessor`/`registerProcessor` declarations (not in the `dom`
  lib), a `DownsampleProcessor` class wrapping Task 5's `createDownsampler`
  (reused, not reimplemented) keyed off `processorOptions.inputRate`, whose
  `process()` forwards each render quantum's channel-0 samples through
  `downsampler.process()` and posts non-empty 16 kHz chunks back via
  `port.postMessage` (transferring the buffer). Registered as
  `'downsample-processor'`.
- `web/src/features/voice/audio-capture.test.ts`: merged the setup.ts fixture
  import with the existing `createDownsampler` import, appended
  `describe('createAudioCapture', ...)` with the 4 tests specified in the
  brief (start/getUserMedia-shape/active, chunk+level fan-out via simulated
  `port.onmessage`, unsubscribe, and full stop()-teardown assertions).

## Commit
- `37ef3ed` — `feat(voice): createAudioCapture (getUserMedia+AudioWorklet) + downsample-worklet processor (D3/D4)`
  (4 files changed: audio-capture.ts, audio-capture.test.ts, downsample-worklet.ts [new], test/setup.ts)

## Gate results
- `cd web && bun run test -- features/voice/audio-capture.test.ts`: RED first
  (`createAudioCapture is not a function`, 4 failing / 7 passing from Task 5),
  then GREEN after implementation — 11/11 passed.
- `cd web && bun run typecheck`: clean (confirms the worklet's ambient
  declarations, `override process()`, and the DOM-lib `AudioContext`/
  `AudioWorkletNode`/`MediaStreamAudioSourceNode` usage in
  `createAudioCapture` all typecheck).
- Full `cd web && bun run test`: 49 files / 219 tests passed (pre-existing
  unrelated `ECONNREFUSED` stderr noise from an unrelated networked test
  that expects a closed connection — not a failure, exit code 0).
- `bun run lint:file -- <4 touched files>` (root, biome): 1 formatting nit on
  first pass (a wrapped type signature in `downsample-worklet.ts`), fixed via
  `bunx biome check --write`, re-ran clean.

## Self-review — teardown correctness (this task's stated real risk)
- `stop()` iterates `stream?.getTracks() ?? []` and calls `.stop()` on
  **every** track (not just track 0) — verified by the `FakeMediaStream`
  fixture, which the test asserts each track's `readyState === 'ended'`
  after `stop()`.
- `ctx?.close()` is awaited and asserted `toHaveBeenCalledTimes(1)`.
- `source?.disconnect()` and `node?.disconnect()` are also called (belt and
  suspenders beyond what the brief's tests assert, but correct Web Audio
  hygiene — a disconnected graph plus a closed context plus stopped tracks
  is the full teardown, not just one of the three).
- All internal refs (`stream`, `ctx`, `source`, `node`) are cleared to
  `undefined` after stop, and `active` flips false — a stale reference can't
  leak into a subsequent `start()` call on the same `AudioCapture` instance.
- Reused `createDownsampler` only inside `downsample-worklet.ts` (imported,
  not duplicated) — matches the "no duplicated resample math" constraint.

## Concerns / notes
- None blocking. `downsample-worklet.ts` cannot be exercised under
  happy-dom/Vitest by design (no real AudioWorkletGlobalScope) — per the
  brief, its correctness rides on Task 5's direct `createDownsampler` unit
  tests plus the Part B live-verify increment (Task 18) that will run it in
  a real browser.
- No `docs/architecture.md` change made (task brief says none needed for
  this internal wiring task); `bun run docs:check` passed as part of the
  pre-commit hook.

Report path: /Users/inderjotsingh/ai/.superpowers/sdd/task-6-report.md
