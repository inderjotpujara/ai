# Task 8 Report: Capture from file (`--voice-in`)

## Implementation

Created `src/voice/capture.ts` exporting:
- `CaptureDeps` — `{ spawn?: (cmd: string[]) => Promise<{ code, stdout: Uint8Array, stderr }> }`, injectable so tests never touch a real subprocess.
- `defaultSpawn(cmd)` — real implementation using `Bun.spawn`, collecting stdout bytes / stderr text / exit code concurrently via `Promise.all`.
- `bytesToFloat32(bytes)` — alignment-safe reinterpret helper (see below).
- `captureFromFile(path, cfg, deps = {})` — builds the ffmpeg argv exactly as specified (`ffmpeg -hide_banner -loglevel error -i <path> -ac 1 -ar 16000 -f f32le pipe:1`), runs it via `deps.spawn ?? defaultSpawn`, and returns `VoiceFrames` (`{ samples, sampleRate: 16000 }`).

## Byte-alignment handling

ffmpeg's stdout arrives as a `Uint8Array` whose underlying `ArrayBuffer` is not guaranteed to start at byte offset 0 or have a length that's a multiple of 4 (e.g. Bun/Node stream buffers are frequently pooled/sliced views into larger buffers). Constructing a `Float32Array` directly over `bytes.buffer` would either throw (`RangeError: byte length not a multiple of 4`) or silently misread samples starting at the wrong offset.

`bytesToFloat32` guards against both:
1. Copies the incoming bytes into a fresh `Uint8Array(bytes.byteLength)` via `.set()` — this allocates a brand-new `ArrayBuffer` with offset 0 and no aliasing to the original pooled buffer.
2. Constructs `Float32Array(copy.buffer, 0, Math.floor(copy.byteLength / 4))` — explicit length in samples (not bytes), floor-dividing so a stray trailing partial sample (0–3 leftover bytes) is silently dropped rather than throwing.

This matches the brief's reference implementation verbatim — preserved as instructed.

## Error handling

- `code !== 0` → `throw new VoiceError('ffmpeg decode failed: ' + stderr)` — message satisfies the test's `/ffmpeg/i` matcher and surfaces ffmpeg's own stderr for diagnosis.
- `samples.length === 0` (empty/silent decode) → `throw new VoiceError('no audio decoded from file')`.
- Both are the typed `VoiceError` from `src/voice/types.ts` (Task 2), not a bare `Error`.

## TDD RED → GREEN

1. **RED**: Wrote `tests/voice/capture-file.test.ts` verbatim from the brief first. Ran `bun test tests/voice/capture-file.test.ts` — failed with `Cannot find module '../../src/voice/capture.ts'` (module didn't exist yet). Confirmed failure before writing implementation.
2. **GREEN**: Wrote `src/voice/capture.ts` per the brief's Step 3. Re-ran the same test — `2 pass, 0 fail, 4 expect() calls`.
3. Ran `bun run typecheck` — clean (`tsc --noEmit`, no output/errors).
4. Ran `bun run lint:file -- "src/voice/capture.ts" "tests/voice/capture-file.test.ts"` — biome flagged 2 pure-formatting diffs (arg-wrapping style on the `spawn` type signature and an inline object literal in the second test). Applied `bunx biome check --write` to both files, then re-ran lint (clean), re-ran the test (still `2 pass`), and re-ran typecheck (still clean) to confirm the auto-format didn't change behavior.

No fixture file (`tests/voice/fixtures/hello.f32`) was created — the brief's own test doesn't need one; it synthesizes Float32 PCM bytes in-memory via the `pcmBytes()` helper and injects a fake `spawn`, so no real ffmpeg or on-disk fixture is exercised. This keeps the test fully hermetic as required.

## Files changed

- `src/voice/capture.ts` (new, 44 lines after formatting)
- `tests/voice/capture-file.test.ts` (new, 26 lines after formatting)

## Self-review

- Interfaces match the brief exactly: `captureFromFile(path, cfg, deps?): Promise<VoiceFrames>`, `CaptureDeps.spawn` signature matches what Task 9 (mic capture) will need to share in the same file.
- `VoiceFrames.sampleRate` is a literal `16000` per `types.ts` — returned directly as the literal, matching the type.
- ffmpeg argv matches the spec string token-for-token (`-hide_banner -loglevel error -i <path> -ac 1 -ar 16000 -f f32le pipe:1`).
- Default real `spawn` (`defaultSpawn`) is exercised only by production code paths / future live-verify (Task 13), never by this unit test — confirmed via `deps.spawn` injection in both test cases.
- Considered whether `bytesToFloat32` should reject a non-multiple-of-4 length instead of silently truncating; kept the brief's floor-and-drop behavior since ffmpeg's f32le output is expected to always be a clean multiple of 4 in practice, and Task 13's live-verify will catch any real-world discrepancy.
- No `console.log` left in; no lint/typecheck suppressions added.

## Commit

- `49d8435` — `feat(voice): capture from file via ffmpeg decode` (on branch `slice-29-voice-input-stt`)

(Note: this file previously held a stale report from Slice 28 Task 8 — the SDD task-numbering restarted per-slice and that filename got reused; this report replaces it with the correct Slice 29 / voice-input Task 8 content.)
