# Slice 29 — CLI voice input (speech-to-text) — design

**Date:** 2026-07-07
**Branch:** `slice-29-voice-input-stt` (off `main`)
**Status:** design approved (brainstorm), spec under review before planning

## Context & framing

This slice is the **re-scoped** Slice 29. The original hand-rolled terminal voice
stack (streaming `parakeet-mlx` STT + `silero-vad` + `sounddevice` + Kokoro/`mlx-audio`
TTS voice-out + barge-in + half-duplex) was **abandoned by user decision** — it fought
the OS (self-echo on speakers, TTS reading markdown literally, needing acoustic echo
cancellation the terminal can't provide). Those 40 commits are archived, unmerged, on
branch `slice-29-voice-streaming-cli` (recoverable). `main` was never touched.

**New scope: voice INPUT only, via a mature open-source STT library reusable in both the
CLI (now) and the future browser UI (Slice 30).** Rich, interruptible ("human") voice —
barge-in, TTS voice-out — belongs in the browser (Slice 30), where
`getUserMedia({ audio: { echoCancellation: true } })` gives native AEC for free (the exact
self-echo wall the terminal hit). This slice deliberately ships **no** TTS, barge-in,
streaming, or duplex.

## Goal (one sentence)

Let a user speak (or point at an audio file) and have the transcript become their
`bun run chat` prompt — via a single STT engine (`sherpa-onnx`) whose transcribe core is
structured for reuse in the Slice-30 browser.

## Decisions (locked with user, 2026-07-07)

- **D1 — Two entry points.** `bun run chat --voice` (live mic) and
  `bun run chat --voice-in <path>` (transcribe an existing audio file). Both produce text
  that is spliced into the prompt.
- **D2 — Capture gesture = tap-to-toggle + VAD auto-stop.** Terminals have **no
  key-release event** (raw TTY gives key-down + OS auto-repeat, nothing on release), so
  literal hold-space-to-talk is not reliably detectable on the CLI without a native macOS
  key-hook (+ Accessibility permission = OS-fighting we avoid). CLI gesture: tap SPACE to
  start; sherpa VAD auto-stops on a natural pause, or tap SPACE/Enter to stop. **True
  hold-space walkie-talkie is a Slice-30 browser feature** (native `keydown`/`keyup`).
- **D3 — Engine = `sherpa-onnx`.** Chosen because it is the only actively-maintained lib
  with true streaming ASR + VAD and first-class bindings for **both** Node.js and browser
  WASM from one codebase (Apache-2.0). CLI uses the `sherpa-onnx-node` N-API addon; Slice
  30's browser reuses the identical API + model files against the WASM build. The
  transcribe core (`Vad` + `OfflineRecognizer`, Float32 / 16 kHz contract) is shared; only
  the capture front-end swaps.
- **D4 — New model download (~120 MB), accepted.** We adopt sherpa-onnx's model *now*
  rather than reuse the already-installed mlx-whisper, so CLI and browser share one
  engine + model (the re-scope rationale). Default STT model
  `sherpa-onnx-moonshine-tiny-en-int8` (~118 MB unpacked, offline, purpose-built for short
  English commands); env-selectable upgrade to `sherpa-onnx-moonshine-base-en-int8`
  (~272 MB). VAD model `silero_vad.onnx` (~2 MB) for the auto-stop.
- **D5 — Mic capture = spawn system `ffmpeg -f avfoundation`.** Bun-native, no native
  audio addon, ffmpeg is already in our auto-setup. `ffmpeg -f avfoundation -i ":<idx>"
  -ac 1 -ar 16000 -f f32le pipe:1` emits exactly the 16 kHz mono Float32 sherpa wants — no
  resampling code. (Deliberate "don't fight the OS" choice — a native audio addon is the
  class of thing that sank the last attempt.)
- **D6 — Execution seam = spike first, then decide.** Whether Bun can load the
  `sherpa-onnx-node` N-API addon is unverified. A `runTranscriber` interface has two
  impls: in-process (Bun loads the addon directly) and node-subprocess (spawn `node` with
  `DYLD_LIBRARY_PATH` set — isolates the addon on its tested runtime). A **day-1
  de-risking spike** smoke-tests the addon under Bun (same pattern as the Slice-23 ai@7
  spike); in-process if it loads, else subprocess. The rest of the slice is agnostic.
- **D7 — Keep the mlx-whisper media path separate.** `src/media/audio/transcribe.ts`
  (mlx-whisper, batch, high-accuracy) stays as-is for `--audio` *attachments*. Voice input
  runs a **parallel** sherpa-onnx path because only sherpa is browser-portable. Unifying
  them is scope creep and would sacrifice browser reuse.
- **D8 — Transcript → prompt splice.** Voice text follows the existing `--audio`
  transcript-splice path (`src/media/ingest.ts:98-105`), NOT the handle/marker path — the
  transcript becomes prompt text the orchestrator already consumes. No orchestrator
  changes.

## Architecture

New subsystem `src/voice/`, two layers behind one interface:

```
--voice ──▶ capture (ffmpeg avfoundation ⇒ Float32 16k frames) ─┐
                                                                 ├─▶ transcribe core (sherpa Vad + OfflineRecognizer) ─▶ text ─▶ prompt
--voice-in <path> ──▶ decode file (ffmpeg ⇒ Float32 16k) ───────┘
```

- **Capture layer** — an interface yielding `Float32 @ 16 kHz` frames. CLI impl:
  ffmpeg-subprocess (live mic tap-to-toggle; file decode). Browser impl (Slice 30):
  `getUserMedia`. This is the swap point.
- **Transcribe core** — `VoiceFrames → string` via sherpa `Vad` (auto-stop) +
  `OfflineRecognizer`. Runs through the D6 execution seam. This is the piece shared with
  Slice 30.

### Components (mirroring `src/media/` conventions)

- `src/voice/types.ts` — `VoiceFrames` (Float32/16k), `Transcript`, config types, typed
  `VoiceError`.
- `src/voice/capture.ts` — ffmpeg avfoundation adapter; tap-to-toggle via raw TTY
  (space=start/stop, Enter=stop); empty/low-energy audio detection.
- `src/voice/transcribe.ts` — sherpa-onnx core (`Vad` + `OfflineRecognizer`); invoked via
  `runTranscriber` (in-process | node-subprocess).
- `src/voice/model.ts` — model + VAD resolution (`~/.cache/ai/voice/`, env
  `AGENT_VOICE_STT_MODEL` / `AGENT_VOICE_STT_CMD`), following `src/media/cmd-resolve.ts`
  (precedence: explicit env override > cached model > error-with-hint).
- `src/cli/chat.ts` — extend `parseMediaArgs` + `IngestFlags` + `hasMediaFlags`; splice the
  voice transcript into the prompt exactly like the `--audio` branch.
- `scripts/setup-voice.ts` + `"setup:voice"` script — idempotent model + VAD download into
  `~/.cache/ai/voice/`, ffmpeg presence check (marker-file idempotency, graceful degrade —
  mirrors `scripts/setup-media.ts`).

### Reuse of existing plumbing

`src/media/spawn.ts` `defaultSpawn`, the `resolveMediaCmd`/`MediaVenv` resolver pattern,
`src/reliability/` `withWallClock` + typed errors + degrade `ledger`, and the telemetry
span helper pattern.

## Error handling / graceful degrade (never crash)

- Wrap capture + transcribe in `withWallClock`; on timeout kill the child process.
- **macOS mic permission is TCC-gated to the terminal host app and fails silently** if
  denied (yields zeros, often no prompt). Detect empty/all-zero capture → print an
  actionable hint: "grant Microphone access to your terminal app in System Settings →
  Privacy & Security → Microphone." A `--voice` diagnostic path may surface device/energy.
- Any capture/transcribe failure → a `warnings` string + a `DegradeEvent` on the run
  ledger; the prompt proceeds without voice — the same per-item degrade the media path
  uses (`ingest.ts` try/catch → warning).
- `DYLD_LIBRARY_PATH` set programmatically in the spawned process env (never rely on user
  shell profile), or the sherpa addon fails to find its `.dylib`s at runtime.

## Testing

- **Hermetic (default suite):** `--voice-in <fixture.wav>` drives the whole path with a
  committed WAV; capture layer mocked; `runTranscriber` stubbed. Arg-parsing +
  prompt-splice + degrade-on-failure unit-tested with fakes.
- **Live-verify (gated `VOICE_LIVE=1`):** real mic + real model end-to-end on this Mac,
  including the mic-permission-denied negative case and the Bun-addon spike result. Per the
  live-verify-before-merge rule.

## Standing spec notes (per repo CLAUDE.md)

- **Architecture-doc update note:** this slice ADDS a subsystem (`src/voice/`).
  `scripts/docs-check.ts` hard-fails until `src/voice` is named in `docs/architecture.md`,
  so a new **§Voice** section is day-one work (file table + data-flow + capture/transcribe
  layering + execution seam + env-var block + live-verify status). Also update the
  subsystem-registry table, README (status line + slice-status row + feature paragraph),
  `docs/ROADMAP.md` (flip "Voice INPUT (STT)" → ✅ shipped Slice 29 in the gap table, phase
  table, and recommended sequence), the SDD ledger `.superpowers/sdd/progress.md`, and
  regenerate the docs-snapshot Artifact (new Voice node + footer slice/test counts).
- **Telemetry to emit:** a `voice.transcribe` span via a new `withVoiceTranscribeSpan`
  helper (mirroring `withTranscribeSpan`), with `VOICE_*` semantic attributes: STT model,
  audio-seconds, duration-ms, outcome (ok|failed|empty|timeout), capture-source
  (mic|file). Degrade events recorded via `recordDegrade` on the ledger.

## Out of scope (explicit)

TTS / voice-out, barge-in, streaming transcription, duplex, true hold-to-talk on the CLI,
and any browser work — all belong to Slice 30 (TUI / local web UI).

## Top risks & mitigations

1. **Bun can't load the `sherpa-onnx-node` N-API addon** → day-1 spike; fall back to the
   node-subprocess `runTranscriber` impl (cheap, since we transcribe post-stop, not
   streaming). Interface hides which impl wins.
2. **macOS mic permission silent failure** → detect empty/low-energy capture; print an
   explicit "enable Microphone for <terminal app>" hint; document the one-time prompt.
3. **`DYLD_LIBRARY_PATH` / native-lib path not set** → set programmatically in the spawned
   env; pin exact package versions (sherpa-onnx ships releases very frequently —
   `sherpa-onnx-node@^1.13.4` current as of 2026-07-07).
4. **Model license** → verify the redistributed Moonshine weights' license in the tarball
   before shipping.
