# Task 14 — final-review fixes (Slice 29 voice input)

Applies all whole-branch final-review findings for Slice 29 (voice input) in
one pass: 2 Important (must-fix) + 6 Minors bundled in. Full verification run
at the end, including both gated live-verify modes.

## IMPORTANT 1 (correctness) — live-mic PCM chunk byte-misalignment

**Problem.** `src/voice/cli-io.ts` `frames()` converted each ffmpeg stdout
chunk independently via `bytesToFloat32`, which floors to whole float32s and
silently drops the trailing 1–3 bytes of any chunk whose length isn't a
multiple of 4. A pipe read is not guaranteed 4-byte aligned, so a misaligned
chunk both dropped a partial sample AND desynced the byte-phase of every
subsequent chunk — garbled waveform, wrong/empty transcript.

**Fix.**
- Added a new pure, exported helper `carryPcmChunk(leftover, chunk)` in
  `src/voice/capture.ts` (co-located with `bytesToFloat32`, which it reuses
  for the actual byte→Float32 copy). It concatenates `leftover + chunk`,
  splits at the last 4-byte-aligned boundary (`whole = floor(combined.byteLength/4)*4`),
  returns `{ floats, leftover }`, where `leftover` (0–3 bytes) carries into
  the next call.
- `src/voice/cli-io.ts`'s `frames()` now keeps `let leftover: Uint8Array = new Uint8Array(0)`
  across the read loop, calls `carryPcmChunk(leftover, value)` on each chunk,
  updates `leftover`, and only yields when `floats.length > 0`. On stream end
  (`done`), any <4-byte leftover is correctly discarded — never consumed.
- `captureFromFile` is unaffected (it buffers the whole ffmpeg stdout via
  `.arrayBuffer()` before decoding once, so there's no chunk-boundary issue
  there) — left untouched, as directed.

**Test.** Extracted the remainder-carry logic into `carryPcmChunk` specifically
so it's hermetically testable without a real ffmpeg pipe. Added to
`tests/voice/capture-file.test.ts`:
- `carries a misaligned remainder across chunk boundaries without dropping or
  shifting samples` — 5 float32 samples split at a byte-6 boundary (NOT a
  multiple of 4); asserts the first chunk yields exactly 1 float + 2
  leftover bytes, and feeding the leftover + second chunk back in yields the
  remaining 4 floats with 0 leftover, and the reassembled samples exactly
  match a non-split decode (compared against the source `Float32Array`'s own
  values, not literal decimal constants, since 0.1 etc. don't round-trip
  exactly through float32).
- `discards a trailing sub-4-byte remainder with no more data (stream end)` —
  confirms a dangling 2-byte tail at end-of-stream is simply never consumed.
- `yields no floats when combined bytes are still under 4` — degenerate
  case, two 1-byte chunks.

## IMPORTANT 2 (security + correctness) — DYLD_LIBRARY_PATH from installed package, not process.cwd()

**Problem.** `src/voice/transcribe.ts` (`defaultLoadSherpa`),
`src/voice/stt-worker.mjs`, and `scripts/spikes/sherpa-bun-smoke.ts` all built
the dyld search dir as `join(process.cwd(), 'node_modules', ...)`. This (a)
would load an attacker-controlled dylib if voice is ever run from an
untrusted cwd containing its own `node_modules/sherpa-onnx-darwin-arm64`, and
(b) broke voice outright whenever the process launched from anywhere other
than the repo root.

**Fix (all three files, same approach).**
- `transcribe.ts`: added `import { createRequire } from 'node:module'` +
  `const require = createRequire(import.meta.url)`, replacing the old bare
  global `require(...)` call (and the vestigial eslint-disable comment,
  which did nothing under this repo's biome-only lint setup).
- New `resolveSherpaDyldDirs()` in each file: calls
  `require.resolve('sherpa-onnx-node')` to get the addon's real installed
  entry path (e.g.
  `/Users/inderjotsingh/ai/node_modules/sherpa-onnx-node/sherpa-onnx.js`),
  locates the `…/node_modules/sherpa-onnx-node/` segment in that resolved
  path, and slices off everything up to and including `node_modules` to get
  the real `node_modules` root — robust even if the package's `main` entry
  is nested deeper than the package folder itself. Throws a clear error if
  the marker isn't found (defensive; shouldn't happen given the package is a
  declared dependency).
- Returns `[join(nodeModulesRoot, 'sherpa-onnx-node'), join(nodeModulesRoot, 'sherpa-onnx-darwin-arm64')]`,
  which `defaultLoadSherpa()`/`loadSherpa()` prepend to
  `DYLD_LIBRARY_PATH` exactly as before (existing value preserved via `??
  ''`).
- `stt-worker.mjs` already used `createRequire`; just replaced its
  `process.cwd()`-based root with the same `require.resolve`-based
  resolution.
- `scripts/spikes/sherpa-bun-smoke.ts` (dev-only spike): same treatment, for
  consistency — added `createRequire`, same `resolveSherpaDyldDirs`,
  replaced the bare `require(...)` call.

**Verified via the live tests** (see Verification below): both in-process
and `AGENT_VOICE_EXEC=subprocess` modes load the real addon and transcribe a
real `say`-generated clip correctly with the new resolution — confirming the
dyld fix didn't break addon loading.

## MINOR 3 (correctness) — subprocess timeout leaves `done` unawaited

**Fix.** In `src/voice/transcribe.ts` `createSubprocessTranscriber`, the
timeout branch now does:
```ts
if (err instanceof Error && err.message === 'timeout') {
  kill();
  done.catch(() => {});
}
```
so a late rejection from the killed subprocess's `done` promise can't become
an unhandled rejection.

## MINOR 4 (correctness + security) — uncapped file decode

**Fix.** `src/voice/capture.ts` `captureFromFile` now checks
`samples.length > MAX_CAPTURE_SAMPLES` (the same 60s/16kHz cap the mic path
already enforces, hoisted above `captureFromFile` so it's in scope) after
decode, and if exceeded, logs a `console.error` notice and truncates via
`samples.subarray(0, MAX_CAPTURE_SAMPLES)` — never throws. Symmetric with the
mic path's `MAX_CAPTURE_SAMPLES` cap.

**Test.** Added `truncates a decode that exceeds MAX_CAPTURE_SAMPLES instead
of throwing` to `tests/voice/capture-file.test.ts` — feeds a fake decode of
`MAX_CAPTURE_SAMPLES + 1600` samples and asserts the returned frames are
truncated to exactly `MAX_CAPTURE_SAMPLES`.

## MINOR 5 (security) — validate `--voice-in` is a local file before ffmpeg

**Fix.** `captureFromFile` now takes an injectable `exists` dep (defaulting
to `existsSync`, mirroring the `isModelReady(dir, exists)` pattern already
used in `scripts/setup-voice.ts`) and throws
`VoiceError('audio file not found: <path>')` before ever spawning ffmpeg if
the path doesn't exist locally. `ingestVoice`'s existing degrade-to-warning
logic handles this exactly like any other capture failure.

**Test.** Added `throws VoiceError before spawning when the file does not
exist` — asserts the mocked spawn is never called.

**Test-suite note:** the two pre-existing `captureFromFile` tests
(`decodes ffmpeg f32le stdout...`, `throws VoiceError when ffmpeg fails`)
used a synthetic path (`'x.wav'`) that doesn't exist on disk; both now pass
`exists: () => true` so the new guard doesn't short-circuit them before
reaching the mocked spawn behavior under test.

## MINOR 6 (security/UX) — raw-TTY process-exit backstop

**Fix.** `src/voice/cli-io.ts`'s mic `onKey` now registers
`process.once('exit', restore)` alongside the existing `restore` (renamed
from the anonymous unsubscribe closure) that turns off the `data` listener
and restores cooked mode. The returned unsubscribe function calls
`process.removeListener('exit', restore)` before invoking `restore()` itself,
so normal completion cleans up the listener; `restore` remains gated by the
existing `unsubscribed` flag, so it's idempotent regardless of which path
(normal unsubscribe vs. the exit backstop) fires first or both fire.

## MINOR 7 (housekeeping) — delete the model archive after extraction

**Fix.** `scripts/setup-voice.ts`: after a successful `tar -xjf` extraction,
best-effort `await rm(archive, { force: true })` (logs but never throws on
failure) so the ~100MB `.tar.bz2` doesn't linger in the voice cache dir.

## MINOR 8 (docs) — two §23 wording fixes in `docs/architecture.md`

**(a) Live-verify tense.** The "Testing + live-verify (honest status)"
subsection said live-verify against the real addon "is **Task 13**, gated
... exactly like the multimodal live-verify pass in §22" (present/pending
framing). Reworded to past tense: it **ran and passed** — a `say`-generated
speech clip transcribed correctly through both execution-seam branches
(in-process and `AGENT_VOICE_EXEC=subprocess`), and the pass caught a real
bug (the `.bytes()`-vs-`.arrayBuffer()` all-zero-buffer issue already
documented in `capture.ts`'s `defaultSpawn` comment). Clarified that only
interactive real-microphone capture remains a manual, human-in-the-loop step
(can't be automated the way `say` automates the file path).

**(b) Telemetry attribute count.** The telemetry paragraph claimed "all
four" `VOICE_*` attributes are set on both success and failure paths inside
the transcriber, but actually listed five attribute names and the up-front
vs. per-call split was miscounted. Corrected: `ATTR.VOICE_STT_MODEL`,
`ATTR.VOICE_CAPTURE_SOURCE`, and `ATTR.INPUT_MODALITY` (`'audio'`) are set
**once up-front** inside `withVoiceTranscribeSpan` (verified in
`src/telemetry/spans.ts` lines 812–814); `ATTR.VOICE_AUDIO_SECONDS`,
`ATTR.VOICE_DURATION_MS`, and `ATTR.VOICE_OUTCOME` are the **three**
attributes actually set inside each transcriber implementation on both the
success and failure paths.

## Verification

All commands run from `/Users/inderjotsingh/ai`.

### `bun test tests/voice/`
```
 38 pass
 0 fail
 68 expect() calls
Ran 38 tests across 10 files. [225ms]
```

### `bun run typecheck`
```
$ tsc --noEmit
(no output — clean)
```
One fix needed along the way: `cli-io.ts`'s `let leftover = new Uint8Array(0)`
inferred as `Uint8Array<ArrayBuffer>` (the concrete return type of the
`Uint8Array` constructor), which didn't accept `carryPcmChunk`'s
`Uint8Array<ArrayBufferLike>`-typed return on reassignment. Fixed by
explicitly annotating `let leftover: Uint8Array = new Uint8Array(0);`.

### `bun run lint` (biome)
```
Checked 493 files in 95ms. No fixes applied.
Found 14 warnings.
```
Exit code 0 (warnings only, all pre-existing `noExplicitAny` warnings in
unrelated test files — none in any file touched by this task). Ran
`bunx biome check --write` on every touched file first; it auto-fixed
formatting in `src/voice/capture.ts` (no functional change).

### `bun run docs:check`
```
✔ docs-check: living docs present + linked; every src subsystem documented.
```

### Full suite (`bun run check` — docs · typecheck · lint · test)
```
 1083 pass
 36 skip
 0 fail
 2449 expect() calls
Ran 1119 tests across 267 files. [252.70s]
```

### Gated live-verify — in-process (default exec)
```
VOICE_LIVE=1 bun test tests/integration/voice.live.test.ts
```
```
[voice.live] transcript (in-process): "The quick brown fox jumps."
 4 pass
 0 fail
 5 expect() calls
Ran 4 tests across 1 file. [2.99s]
```

### Gated live-verify — subprocess exec
```
AGENT_VOICE_EXEC=subprocess VOICE_LIVE=1 bun test tests/integration/voice.live.test.ts
```
```
[voice.live] transcript (subprocess): "The quick brown fox jumps."
 4 pass
 0 fail
 6 expect() calls
Ran 4 tests across 1 file. [2.79s]
```

Both live runs transcribed the real `say`-generated clip correctly
("fox"/"quick"/"brown" all present), confirming:
- IMPORTANT 2's install-relative `DYLD_LIBRARY_PATH` resolution still loads
  the real `sherpa-onnx-node` addon correctly in both exec modes.
- IMPORTANT 1's `carryPcmChunk` fix doesn't regress `captureFromFile`'s
  existing decode path (used by the live test's file-based capture) and is
  sound at the byte-boundary seam per the added unit tests.

## Files changed

- `src/voice/capture.ts` — `carryPcmChunk` helper, `exists` guard + injectable
  dep, `MAX_CAPTURE_SAMPLES` cap on file decode (hoisted constants above
  `captureFromFile`).
- `src/voice/cli-io.ts` — `frames()` remainder-carry via `carryPcmChunk`;
  `onKey` process-exit TTY restore backstop.
- `src/voice/transcribe.ts` — install-relative `resolveSherpaDyldDirs` via
  `createRequire`/`require.resolve`; unawaited `done` fix on subprocess
  timeout.
- `src/voice/stt-worker.mjs` — same install-relative dyld resolution.
- `scripts/spikes/sherpa-bun-smoke.ts` — same install-relative dyld
  resolution (dev-only spike, kept consistent).
- `scripts/setup-voice.ts` — delete archive after successful extraction.
- `docs/architecture.md` §23 — live-verify tense fix; telemetry attribute
  count/split fix.
- `tests/voice/capture-file.test.ts` — new tests for `carryPcmChunk`
  (remainder-carry across boundaries, stream-end discard, under-4-byte
  degenerate case), file-not-found guard, and the file-decode length cap;
  existing two tests updated to inject `exists: () => true`.

## Items not fully fixed

None — all 8 findings (2 Important + 6 Minor) were fixed and verified,
including both gated live-verify runs against the real sherpa-onnx-node
addon.
