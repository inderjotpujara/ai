# Task 11 Report: Voice ingest + chat wiring (Slice 29)

*(Note: this path previously held a stale Slice-26 report for a differently-numbered
Task 11 — "Browser loopback OAuth callback server." Overwritten here per the
per-slice task-numbering convention that report itself documented.)*

## Status: DONE_WITH_CONCERNS (concerns are all live-verify-only, see below)

## Files changed
- `src/voice/ingest.ts` (new) — `ingestVoice()`, TDD-tested.
- `src/voice/cli-io.ts` (new) — real ffmpeg/TTY `MicIo` + real deps factory.
- `src/voice/capture.ts` — exported `bytesToFloat32` (was file-private) so `cli-io.ts` reuses the same byte→Float32 conversion instead of duplicating it.
- `src/cli/chat.ts` — wired `ingestVoice` before `ingestMedia`; new imports of `createCliVoiceDeps`/`ingestVoice`.
- `tests/voice/ingest.test.ts` (new) — the brief's 3 unit tests, verbatim.

## `ingestVoice` design (`src/voice/ingest.ts`)
Signature: `ingestVoice(rawPrompt, flags, deps): Promise<{ prompt, warnings }>`, `deps = { captureFile, captureMic, transcriber, ledger? }`.

- Iterates `flags.voiceIn` (file paths) then, if `flags.voice`, does one mic capture — each routed through a shared `collect()` helper: capture → `transcriber.transcribe()` → trim → push non-empty text into `transcripts`.
- Never throws: `collect()` wraps both the capture call and the transcribe call in one try/catch. On failure it pushes `voice: <message>[ — <hint>]` (hint comes from `VoiceError.hint` when present) into `warnings`, and calls `deps.ledger?.record({ kind: DegradeKind.ToolSkipped, subject: 'voice', reason: message })`. Optional-chained on `ledger` per the corrected ledger API (param type is `DegradationLedger | undefined`).
- Final prompt: `[rawPrompt, ...transcripts].filter(Boolean).join('\n\n').trim()` — so a failed capture (empty `transcripts`) returns the prompt byte-for-byte unchanged (verified by test 2 and test 3).
- Multiple `--voice-in` paths would each append their own transcript block; only tested with one path (matches the brief's 3 tests) — multi-file-plus-mic composition is a straightforward extension of the same loop, not exercised here.

### TDD RED → GREEN
1. Wrote `tests/voice/ingest.test.ts` verbatim from the brief (3 cases: file transcript appended; capture failure degrades to warning + unchanged prompt; no voice flag → unchanged prompt).
2. `bun test tests/voice/ingest.test.ts` → RED: `Cannot find module '../../src/voice/ingest.ts'`.
3. Implemented `src/voice/ingest.ts` per the brief's sketch, corrected to the real `DegradeEvent` shape (`{kind, subject, reason}` — the brief's own sketch used a nonexistent `detail`-only call, which is why the task explicitly called out the corrected API).
4. `bun test tests/voice/ingest.test.ts` → GREEN: 3 pass, 6 expect() calls.

## `cli-io.ts` design (real, not unit-tested — live-verify only)
- `resolveVoiceConfig(env)`: builds `VoiceConfig` from `resolveVoiceModel(env)` / `ffmpegCmd(env)` / a timeout. Timeout reuses `AGENT_MEDIA_TIMEOUT_MS` (the one existing media-pipeline timeout env — didn't invent a voice-only var) with a **30_000 ms default**, distinct from the media pipeline's 600_000 ms default: a single interactive capture/transcribe turn should fail fast, not hang a chat session for 10 minutes.
- `captureFromFile` bound to that config (straight reuse of Task 8's function).
- Real `MicIo`:
  - `start()` spawns `ffmpeg -hide_banner -loglevel info -f avfoundation -i :<AGENT_MIC_INDEX|0> -ac 1 -ar 16000 -af silencedetect=noise=-35dB:d=0.8 -f f32le pipe:1`.
  - `frames`: an async generator reading `child.stdout`'s `ReadableStream`, converting each chunk via the now-exported `bytesToFloat32`.
  - `silenceSignaled`: reads `child.stderr` line-by-line watching for `silencedetect`'s `silence_start`/`silence_end` markers.
  - `stop()`: `child.kill('SIGTERM')` wrapped in try/catch (tolerates an already-exited process), then awaits `child.exited`.
  - `onKey`: sets raw mode on `process.stdin` when it's a TTY, maps byte `0x20`→`space`, `0x0d`/`0x0a`→`enter`, `0x03`→`ctrl-c`; unsubscribe restores the prior raw-mode state.
  - `print`: `console.error`.
- `createCliVoiceDeps(ledger?, env?)`: assembles `{ captureFile, captureMic, transcriber, ledger }` (exactly `VoiceIngestDeps`, plus the `transcriber` typed on the return so the caller can `close()` it).

### Silencedetect heuristic (flagged as an assumption for Task 13 to confirm live)
`silencedetect` logs `silence_start` the moment the input drops below the noise floor. A session starts amid ambient silence, so naively resolving on the *first* `silence_start` would cut the recording before the user speaks. Chosen heuristic: track a `sawSpeech` flag that flips true on the first `silence_end` (signal rose above the floor — the user started talking), and only resolve `silenceSignaled` on a `silence_start` **after** that. If silencedetect never fires (no device, permission prompt swallowing the stream, etc.) the promise simply never resolves — `captureFromMic` (Task 9, unchanged) still terminates via manual space/enter or its `MAX_CAPTURE_SAMPLES` hard cap, so this is a convenience, not a correctness dependency. This exact behavior needs a real mic + real ffmpeg to confirm — DONE_WITH_CONCERNS item for Task 13.

## Chat wiring (`src/cli/chat.ts`)
Inside the `withMcpRun` callback, right after `createMediaStore(run.dir)` and before `ingestMedia`:
- Guarded on `flags.voice || flags.voiceIn.length > 0` (so a plain text/media chat never pays for loading the sherpa-onnx transcriber).
- Calls `createCliVoiceDeps(ledger)` → `ingestVoice(rawPrompt, flags, voiceDeps)`, prints each warning via `console.error(warning)` (not re-prefixed — `ingestVoice`'s warnings already carry a `voice: ` prefix baked in, so double-prefixing was avoided), and always `close()`s the transcriber in a `finally`.
- The resulting prompt (`promptWithVoice`) — not the raw positional-arg prompt — is what's passed into `ingestMedia`, so a typed prompt + voice transcript + `--image`/`--audio`/`--video`/auto-detected paths all compose into the final `task` string.

## What is live-verify-only (Task 13)
- The real `MicIo` (`cli-io.ts`) — spawning actual ffmpeg against `avfoundation`, raw-TTY key handling, and the `silencedetect` heuristic above — cannot be exercised by a unit test without a real mic/TTY; per the constraints this task deliberately did not write brittle fakes for it.
- End-to-end `--voice` / `--voice-in` runs through `chat.ts` with a real transcriber + real audio.
- Confirm the 30s default voice timeout is sane for real moonshine-tiny inference latency on target hardware.

## Self-review
- `bun test tests/voice/ tests/cli/ tests/media/` → 239 pass / 0 fail across 61 files (no regressions).
- `bun run typecheck` → clean.
- `bun run lint:file` on all 5 touched/created files → clean (after one `biome check --write` pass for import order + line wrapping).
- Checked for import cycles: `src/voice/*` does not import anything from `src/cli/*`; `chat.ts` imports `voice/cli-io.ts` and `voice/ingest.ts` one-way. No cycle.
- `src/voice/capture.ts`'s only change is exporting an already-existing private helper (`bytesToFloat32`) — no behavior change; its existing tests (`capture-file.test.ts`, `capture-mic.test.ts`) still pass.
