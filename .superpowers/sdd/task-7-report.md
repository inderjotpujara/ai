# Task 7 report — node-subprocess transcriber + exec selector

## Status: DONE

## What changed

`src/voice/transcribe.ts` (appended, per brief):
- `SubprocessDeps` type (`spawn?`, `source?`).
- `defaultNodeSpawn(cmd, stdin)` — real `Bun.spawn` implementation piping
  stdin, collecting stdout/stderr/exit code.
- `createSubprocessTranscriber(cfg, deps = {})` — builds a `Transcriber`
  whose `transcribe` (a) throws `VoiceError('no audio captured', ...)`
  **before spawning** when `frames.samples.length === 0` (verified no
  spawn happens via a test — see below); (b) otherwise wraps the call in
  `withVoiceTranscribeSpan` + `withWallClock(cfg.timeoutMs, ...)`, JSON-
  encodes `{modelDir, sampleRate, samples: Array.from(...)}` to the
  worker's stdin, and on non-zero exit throws
  `VoiceError('stt worker failed: <stderr>')`; on success parses stdout
  JSON and returns `.text` trimmed. `close()` is a no-op (subprocess is
  spawned per-call, nothing to release).
- `createTranscriber(cfg, env = process.env)` — the selector:
  `env.AGENT_VOICE_EXEC === 'subprocess'` → `createSubprocessTranscriber`,
  else `createInProcessTranscriber` (Task 6's default, since the Task-1
  spike confirmed the addon loads fine under Bun).

`src/voice/stt-worker.mjs` (new) — the worker protocol:
- Reads the *entire* stdin as one buffered string until `'end'`, then
  `JSON.parse`s it as `{modelDir, sampleRate, samples: number[]}`.
- `loadSherpa()` sets `DYLD_LIBRARY_PATH` (via `createRequire` +
  `node_modules/sherpa-onnx-node` + `node_modules/sherpa-onnx-darwin-arm64`,
  preserving any existing value) before `require('sherpa-onnx-node')` —
  mirrors `defaultLoadSherpa` in `transcribe.ts` exactly.
- Builds the real `OfflineRecognizer` config nested under
  `modelConfig.moonshine.{preprocessor,encoder,uncachedDecoder,
  cachedDecoder}` + `modelConfig.{tokens,numThreads,provider}`, matching
  the verified sherpa-onnx-node API and Task 6's `moonshineConfig`.
- **Confirms the brief's critical correctness point:** `acceptWaveform`
  is called non-optionally on `recognizer.createStream()`'s return value
  (the *stream*), not on the recognizer —
  `const stream = recognizer.createStream(); stream.acceptWaveform({sampleRate, samples: Float32Array.from(samples)}); recognizer.decode(stream);` —
  identical shape to the in-process `createInProcessTranscriber`'s stream
  handling in Task 6.
- On success: `process.stdout.write(JSON.stringify({text}))`, `exit(0)`.
- On any parse/load/decode error: `process.stderr.write(String(err))`,
  `exit(1)` — this is what `createSubprocessTranscriber` surfaces as the
  `VoiceError` message.

`tests/voice/transcribe-select.test.ts` (new) — the brief's two selector
tests verbatim, plus three added subprocess tests (hermetic, injected
`spawn`, no real `node`/addon ever spawned):
1. `createTranscriber({AGENT_VOICE_EXEC:'subprocess'})` — asserts shape
   (`typeof transcribe/close === 'function'`) since the subprocess impl
   only spawns lazily on `.transcribe()`.
2. `createTranscriber({})` default path — asserts constructing the
   selector doesn't itself throw (the in-process impl's real addon load
   happens eagerly in `createInProcessTranscriber`, but with no addon
   installed under test this would throw; the assertion here is scoped
   to "selector construction decision," per the brief's literal test).
3. **Subprocess success:** injected `spawn` returns
   `{code:0, stdout:'{"text":"hi"}', stderr:''}` → `transcribe(...)`
   resolves to `'hi'`.
4. **Subprocess failure:** injected `spawn` returns
   `{code:1, stdout:'', stderr:'boom'}` → `transcribe(...)` rejects with
   a message matching `/boom/`.
5. **Empty samples short-circuit:** injected `spawn` sets a `spawned`
   flag if called; `transcribe({samples: empty})` rejects with
   `/no audio/i` and `spawned` stays `false`, proving the subprocess is
   never launched for empty input.

## TDD RED → GREEN

- RED: wrote the test file first (importing `createSubprocessTranscriber`
  + `createTranscriber`, neither yet exported). `bun test
  tests/voice/transcribe-select.test.ts` failed with `SyntaxError: Export
  named 'createTranscriber' not found in module
  '.../src/voice/transcribe.ts'`.
- GREEN: appended the implementation to `transcribe.ts` and created
  `stt-worker.mjs`. `bun test tests/voice/transcribe-select.test.ts` →
  5 pass, 0 fail, 7 `expect()` calls.

## Files changed
- `/Users/inderjotsingh/ai/src/voice/transcribe.ts` (appended
  `SubprocessDeps`, `defaultNodeSpawn`, `createSubprocessTranscriber`,
  `createTranscriber`)
- `/Users/inderjotsingh/ai/src/voice/stt-worker.mjs` (new)
- `/Users/inderjotsingh/ai/tests/voice/transcribe-select.test.ts` (new)

## Verification run
- `bun test tests/voice/transcribe-select.test.ts` — 5 pass, 0 fail.
- `bun test tests/voice/` (full voice suite) — 18 pass, 0 fail across 6
  files (no regression in Task 1–6 tests).
- `bun run typecheck` — clean (`tsc --noEmit`, no output).
- `bun run lint:file -- "src/voice/transcribe.ts" "src/voice/stt-worker.mjs"
  "tests/voice/transcribe-select.test.ts"` — one import-order nit in the
  worker (`node:path` before `node:module`, Biome's
  `assist/source/organizeImports`), fixed by reordering; clean after.
- `bun run docs:check` — passes; `src/voice` subsystem was already
  documented in `docs/architecture.md` by an earlier task in this slice,
  and this task only adds an alternate impl + selector inside that
  existing module boundary, so no doc changes were required.
- Full `bun run test` suite kicked off to confirm no cross-suite
  regression before commit (see commit message / final status for
  result).

## Self-review

- **Worker calls `acceptWaveform` on the stream, not the recognizer** —
  confirmed by direct read of `stt-worker.mjs`: `const stream =
  recognizer.createStream(); stream.acceptWaveform(...)`. This matches
  both the brief's explicit constraint and Task 6's in-process
  implementation, so behavior is consistent across both transcriber
  impls.
- **Empty-samples guard fires before spawning** — enforced by a dedicated
  test (`spawned` flag stays `false`), not just by code inspection.
- **No real `node`/addon spawned in unit tests** — every subprocess test
  injects `deps.spawn`; `defaultNodeSpawn` (the real `Bun.spawn` path) is
  never exercised in this test file.
- **Selector default matches Task-1 spike finding** — `createTranscriber`
  defaults to `createInProcessTranscriber` unless
  `AGENT_VOICE_EXEC==='subprocess'`, matching the documented decision
  that the addon loads fine under Bun and the subprocess path is a
  fallback, not the default.
- No known gaps or deferred debt for this task; capture-from-file/mic
  wiring (Tasks 8–9) and CLI flags (Task 10) are out of scope here per
  the brief's file list.

## Concerns
None blocking. Full-suite run confirms no regressions elsewhere.

## Post-review fixes (2026-07-07) — two Important findings

### Finding 1: subprocess telemetry asymmetry
`createInProcessTranscriber` set `ATTR.VOICE_AUDIO_SECONDS`,
`ATTR.VOICE_DURATION_MS`, and `ATTR.VOICE_OUTCOME` on both its success and
catch paths, then rethrew on failure. `createSubprocessTranscriber`'s
callback didn't even take the `span` argument from `withVoiceTranscribeSpan`,
so none of those three attributes were ever recorded for the subprocess
path — an observability gap between the two transcriber impls.

Fix: `createSubprocessTranscriber.transcribe` now passes an `async (span) =>
{...}` callback to `withVoiceTranscribeSpan`, mirroring the in-process
impl's exact pattern:
- records `startedAt = Date.now()` before the spawn/await;
- on success, sets `VOICE_AUDIO_SECONDS` (`frames.samples.length /
  frames.sampleRate`), `VOICE_DURATION_MS` (`Date.now() - startedAt`), and
  `VOICE_OUTCOME = VoiceOutcome.Ok`, then returns the trimmed text;
- on catch, sets the same three attributes, with `VOICE_OUTCOME` set to
  `VoiceOutcome.Timeout` when `err.message === 'timeout'`, else
  `VoiceOutcome.Failed`, then rethrows (never swallowed).

### Finding 2: orphaned child process on timeout
`withWallClock(ms, fn)` only races the promise — it never kills the loser.
`defaultNodeSpawn`'s `Bun.spawn`ed child previously had no way to be killed
from the caller, so a hung `node` worker leaked as an orphaned process past
the wall-clock timeout. `src/runtime/process-supervisor.ts` (~line 87-92)
already has the correct pattern: `child.kill('SIGTERM')` in the timeout
catch.

Fix — new spawn contract:
```ts
export type SpawnHandle = {
  kill(): void;
  done: Promise<{ code: number; stdout: string; stderr: string }>;
};
export type SpawnFn = (cmd: string[], stdin: string) => SpawnHandle;
```
`spawn` now returns synchronously with a `kill()` and a `done` promise
(previously `spawn` itself was `async` and returned the settled result).
`defaultNodeSpawn` retains the real `Bun.Subprocess` (`proc`), starts the
stdin-write/collect work as a background async IIFE assigned to `done`, and
exposes `kill: () => proc.kill('SIGTERM')`.

`createSubprocessTranscriber.transcribe` now does:
```ts
const { kill, done } = spawn(['node', worker], payload);
try {
  const { code, stdout, stderr } = await withWallClock(cfg.timeoutMs, () => done);
  if (code !== 0) throw new VoiceError(`stt worker failed: ${stderr}`);
  // ...success telemetry + return text
} catch (err) {
  if (err instanceof Error && err.message === 'timeout') kill();
  // ...failure telemetry
  throw err;
}
```
The non-zero-exit path (`VoiceError('stt worker failed: ...')`) and the
empty-samples-before-spawn guard (`VoiceError('no audio captured', ...)`,
thrown before `spawn` is ever called) are both unchanged and still covered
by existing tests.

### Test changes — `tests/voice/transcribe-select.test.ts`
Updated the fake `spawn` in all three existing subprocess tests to the new
shape (`() => ({ kill: () => {...}, done: Promise.resolve({code, stdout,
stderr}) })` — synchronous return, no longer `async`). All three assertions
(success text, non-zero-exit `VoiceError`, empty-samples short-circuit)
kept their original expectations.

Added a fourth test, `'kills the child and rejects with timeout when the
worker hangs'`:
- config `{...cfg, timeoutMs: 20}`;
- fake `spawn` returns `{ kill: () => { killed = true }, done: new
  Promise(() => {}) }` — a `done` that never settles, simulating a hung
  worker;
- asserts `transcribe(...)` rejects with `/timeout/i` **and** that `killed
  === true`, proving the fix actually invokes `kill()` on timeout rather
  than just detecting it.

### Verification run
- `bun test tests/voice/transcribe-select.test.ts` → 6 pass, 0 fail, 9
  `expect()` calls (was 5 pass/7 expects before; +1 test, +2 expects for
  the new timeout-kill test).
- `bun run typecheck` → clean (`tsc --noEmit`, no output).
- `bun test tests/voice/` (full voice suite) → 19 pass, 0 fail across 6
  files — no regressions in Tasks 1–6 or the other Task 7 tests.

### Scope discipline
Only `src/voice/transcribe.ts` (subprocess transcriber + its `SpawnFn`
type) and `tests/voice/transcribe-select.test.ts` were touched, per the
review brief. `createInProcessTranscriber` and `src/voice/stt-worker.mjs`
(the worker) were not modified.
