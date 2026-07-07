# Task 13 report — Slice 29 (voice input / STT) live-verify

**Note on the brief:** this filename previously held a Task 13 report from an earlier slice
(Slice 15, MCP OAuth config schema — confirmed via `progress.md` line 575: "S15 Task 13: ...
httpAuthSchema widened ..."). Slice 29 also numbers this task "13" (the live TaskList shows
"T13: live-verify (gated) + edge cases", and `progress.md` line 727: "Live-verify: Task 13
(gated, not yet run ...)"). No slice-29-specific brief file was ever written under this name —
I proceeded directly from the parent task's instructions, which were self-contained.

## Status: DONE_WITH_CONCERNS

One real, load-bearing bug found and fixed (empty transcripts). One architectural limitation
found, verified, and documented (not fixed — out of scope for a "straightforward" live-verify
fix). No filename/config mismatches (the brief anticipated these; they didn't occur).

## 1. Provisioning (`bun run setup:voice`)

Ran clean. Downloaded `sherpa-onnx-moonshine-tiny-en-int8.tar.bz2` (~102MB) from the
`k2-fsa/sherpa-onnx` GitHub release, extracted to
`~/.cache/ai/voice/sherpa-onnx-moonshine-tiny-en-int8/`.

Extracted contents:
```
cached_decode.int8.onnx   45,264,830 bytes
encode.int8.onnx          18,249,187 bytes
LICENSE
preprocess.onnx            6,800,738 bytes
README.md
test_wavs/                (0.wav, 1.wav, 8k.wav, trans.txt)
tokens.txt                    436,688 bytes
uncached_decode.int8.onnx 53,216,096 bytes
```

**Filename check: MATCH.** `transcribe.ts`'s `moonshineConfig` and `stt-worker.mjs` expect
exactly `preprocess.onnx`, `encode.int8.onnx`, `uncached_decode.int8.onnx`,
`cached_decode.int8.onnx`, `tokens.txt` — all present verbatim. No path-construction fix needed.

## 2. Live test written

`tests/integration/voice.live.test.ts`, gated `describe.if(process.env.VOICE_LIVE === '1')`.
4 tests:
1. Transcribes a real `say`-generated speech clip ("the quick brown fox jumps"), asserts
   non-empty text matching `/fox|quick|brown/i`.
2. Silent/near-empty clip (0.2s `ffmpeg anullsrc`) — asserts no crash; documents that
   `ingestVoice` intentionally does NOT warn on an empty-but-successful transcription (only
   actual thrown errors become warnings — see finding below).
3. Bogus `modelDir` (`/tmp/nonexistent-voice-model-dir`) — mode-aware: in-process throws
   eagerly at `createTranscriber` (construction), subprocess throws at `.transcribe()`
   (construction is deferred into the worker). Both are catchable JS errors, never a crash.
4. Tight timeout budget (`timeoutMs: 1`) — mode-aware (see Finding 2 below): subprocess
   actually honors it (throws `Error('timeout')`); in-process cannot and completes normally
   (documented, not asserted as a bug).

## 3. THE BUG: empty transcripts (FOUND + FIXED)

First run of test 1 (in-process) produced `transcript: ""` — total silence out of a clearly
audible `say`-generated clip. Manual reproduction (`node`, same ffmpeg pipeline, same
sherpa-onnx-node binding) transcribed correctly ("The quick brown fox jumps.") in 68ms — so the
model/addon/ffmpeg pipeline was fine. Isolated to **Bun-only**: under `bun run`, `frames.samples`
had **zero peak amplitude** (`peak = 0`) even though the raw ffmpeg stdout bytes were correct.

Root cause: `src/voice/capture.ts`'s `defaultSpawn` used
`new Response(p.stdout).bytes()`. On this Bun build (**1.3.11**), that call returns an object
whose prototype is `ArrayBuffer.prototype` (`instanceof Uint8Array` is `false`, no `.length`
property) — not a spec-correct `Uint8Array`. `bytesToFloat32`'s `copy.set(bytes)` then silently
copies **zero elements** (`TypedArray.prototype.set` reads `bytes.length`, which is `undefined`
→ treated as 0), leaving `copy` all-zero. No exception anywhere — a silent data-corruption bug
that always produced an empty transcript for every file/mic capture.

**Fix** (`src/voice/capture.ts`): swapped `.bytes()` for `.arrayBuffer()` + `new Uint8Array(buf)`,
which is unambiguous and verified to return a real, correctly-populated `Uint8Array` on this
Bun version. Verified: `frames.samples` peak amplitude now `0.809` (correct), transcript now
`"The quick brown fox jumps."`.

Checked whether other media capture code shares this pattern (`grep -rn ".bytes()\|Response("`
across `src/media/*`, `src/runtime/process-supervisor.ts`) — no other call site uses
`Response(...).bytes()`; this was isolated to voice's `capture.ts`.

## 4. Real transcript produced

- **In-process** (`VOICE_LIVE=1 bun test tests/integration/voice.live.test.ts`): `"The quick
  brown fox jumps."` — 4/4 tests pass.
- **Subprocess** (`AGENT_VOICE_EXEC=subprocess VOICE_LIVE=1 bun test ...`): `"The quick brown fox
  jumps."` (identical) — 4/4 tests pass.

## 5. Edge cases

**(a) Silent/tiny file:** 0.2s of digital silence via `ffmpeg anullsrc` → decodes to a non-empty
sample buffer (near-zero amplitude, not literally 0 samples) → recognizer returns `""` →
`ingestVoice`'s `collect()` sees a falsy `text` and simply doesn't push it to `transcripts`
(no warning recorded). Verified: `result.prompt` stays exactly the original prompt, no crash.
**Finding:** the brief expected "empty transcript → warning"; actual (and, on inspection,
intentional) design only warns on *thrown* capture/transcribe failures, not on a
successful-but-empty transcription of silence. This is reasonable behavior, not a bug — adjusted
the test to assert the real contract (no crash) rather than force a design change.

**(b) Model-not-downloaded degrade:** `AGENT_VOICE_DIR=/tmp/nonexistent-voice-model-dir`
(bogus). In-process: `createTranscriber` throws synchronously at construction (mirrors chat.ts's
own try/catch around `createCliVoiceDeps`) — a catchable JS error, confirmed NOT a native
segfault, just a sherpa-onnx C++ validation error surfaced as a JS exception:
`tokens: '.../tokens.txt' does not exist ... Errors in config`. Subprocess: construction succeeds
(model loading is deferred into the worker process), and the failure surfaces at
`.transcribe()` as `VoiceError: stt worker failed: ...` — also catchable, also non-crashing.
Both paths confirm the Task-11 chat.ts never-crash contract holds for real (not mocked) sherpa
failures.

**(c) Timeout — real architectural finding (documented, not fixed):**
- **Subprocess** (`AGENT_VOICE_EXEC=subprocess`): a 1ms `timeoutMs` reliably rejects with
  `Error('timeout')` in ~5ms — the worker runs out-of-process, so the parent's event loop stays
  free to service the timer and `kill()` the child. Confirmed working correctly.
- **In-process** (default): a 1ms `timeoutMs` does **not** time out — the transcription
  completes normally in ~19ms regardless. Root cause: `recognizer.decode()` is a synchronous,
  CPU-blocking native call with no internal yield point; `withWallClock`'s `Promise.race` can
  only lose to a timer callback that gets a chance to run, and Bun/Node's event loop cannot
  service a `setTimeout` while the JS thread is blocked inside a synchronous native call — no
  matter how tiny `timeoutMs` is. This is a genuine, real gap in the in-process path's timeout
  enforcement, live-verified and reproduced deterministically (isolated scripts, both with the
  bundled 1.6s clip and cross-checked against the subprocess path on the same input).
  - **Scope decision:** not fixed here. A real fix requires either running the addon in a
  worker thread (uncertain the N-API addon supports that transfer boundary) or defaulting to
  subprocess whenever an enforceable timeout matters — both are design decisions bigger than a
  "straightforward" live-verify fix, and the default 30s budget makes this low-probability to
  bite in practice (single utterances decode in tens of ms on this hardware). Flagging as a
  concern/follow-on for the final review or a future slice: **in-process `AGENT_MEDIA_TIMEOUT_MS`
  is not actually enforced against a hung/slow native decode; `AGENT_VOICE_EXEC=subprocess` is
  the only mode that gives a real wall-clock guarantee.**

## 6. CLI end-to-end

```
say -o /tmp/cli-voice-test.aiff "my favorite color is blue"
ffmpeg -y ... -i /tmp/cli-voice-test.aiff /tmp/cli-voice-test.wav
bun run src/cli/chat.ts --voice-in /tmp/cli-voice-test.wav "what did I say my favorite color is?"
```
Output: `You said your favorite color is **blue**.` — full stack (real Ollama router model
`qwen3.5:4b`, real voice transcription, real chat) confirmed the voice transcript splices
correctly into the prompt and the model answers from it.

## 7. Real-mic `--voice` (flagged as a USER step — cannot be automated)

Ran `ffmpeg -f avfoundation -list_devices true -i ""` to sanity-check device plausibility (no
actual capture — needs a human to speak, tap space, and grant mic permission, which this
environment cannot do). Confirmed an audio input device list exists:
```
[0] iPhone Microphone
[1] MacBook Pro Microphone
```
Note for the user: the code's default `AGENT_MIC_INDEX` is `0`. On this machine that currently
resolves to **iPhone Microphone** (via Continuity), not the built-in mic — index ordering is
session-dependent (Continuity devices can shift indices). If `--voice` picks up the wrong
device, set `AGENT_MIC_INDEX=1` (or whatever `-list_devices` reports for the built-in mic) as a
workaround; this is expected/inherent to avfoundation enumeration, not a bug.

**USER ACTION NEEDED:** the interactive `--voice` (tap-to-record) path itself — speaking into
the mic, tapping space to stop, granting the macOS mic-permission prompt to the terminal app —
must be exercised by a human; it cannot be scripted in this environment.

## 8. Bugs found + fixed

1. **Critical — silent data corruption:** `src/voice/capture.ts` `defaultSpawn` used
   `Response(p.stdout).bytes()`, which on Bun 1.3.11 returns a non-Uint8Array object with no
   `.length`, causing `bytesToFloat32`'s `copy.set(bytes)` to silently copy zero bytes. Every
   voice capture (file and, by the same code path, mic) transcribed to an empty string with no
   error surfaced anywhere. **Fixed** by switching to `.arrayBuffer()` + `new Uint8Array(buf)`.

## 9. Files changed

- `src/voice/capture.ts` — the fix (bug #1 above).
- `tests/integration/voice.live.test.ts` — new gated live test (4 cases, both exec modes
  live-verified).

## 10. Verification run

- `bun run typecheck` — clean.
- `bun run lint:file -- "src/voice/capture.ts" "tests/integration/voice.live.test.ts"` — clean.
- `VOICE_LIVE=1 bun test tests/integration/voice.live.test.ts` — 4 pass, 0 fail.
- `AGENT_VOICE_EXEC=subprocess VOICE_LIVE=1 bun test tests/integration/voice.live.test.ts` — 4
  pass, 0 fail.
- Full suite `bun run test` — 1077 pass / 36 skip / 0 fail (voice.live skipped without
  `VOICE_LIVE=1`, as designed) — no regressions from the capture.ts fix.

## 11. Closeout — two small fixes surfaced by live-verify

### Change 1 — docs-accuracy: document the in-process timeout limitation

Live-verify (this task) established that `recognizer.decode()` in
`createInProcessTranscriber` (`src/voice/transcribe.ts`) is a **synchronous native call** that
blocks the JS event loop. `withWallClock(cfg.timeoutMs, ...)` races a `setTimeout` against the
work — but since the event loop is blocked for the whole `decode()` call, the timer callback
cannot run until `decode()` itself returns, i.e. the timeout is a no-op on this path. The
**subprocess** path (`AGENT_VOICE_EXEC=subprocess`) does not have this problem: `decode()` runs
in a separate `node` worker process, so the parent's `withWallClock` timer fires on schedule and
`kill()` terminates the worker.

The existing docs (§23 of `docs/architecture.md`) described both paths as wrapped in "the
identical `withWallClock` shape" without noting this asymmetry — which could mislead a reader
into thinking the in-process timeout is enforced. Fixed by adding a "Known limitation" paragraph
immediately after the execution-seam description (before "### Auto-stop"), and a one-line code
comment in `src/voice/transcribe.ts` directly above the in-process `withWallClock` call.

### Change 2 — minor UX: warn on an empty --voice-in transcript

`ingestVoice`'s `collect()` helper (`src/voice/ingest.ts`) previously did `if (text)
transcripts.push(text)` — a successful capture+transcribe that yields an empty string (e.g. a
silent `--voice-in` file) was silently dropped with zero user feedback. Fixed: the success path
now pushes an informational warning `voice: no speech detected in the audio` when the trimmed
transcript is empty, without recording a ledger degrade (this isn't a failure — it's empty
input) and without throwing. The existing throw-path (capture/transcribe throws) is untouched.

Added a new test in `tests/voice/ingest.test.ts`:
`warns (no throw) when capture+transcribe succeed but yield no speech` — asserts the prompt is
unchanged and `warnings` equals exactly `['voice: no speech detected in the audio']`.

### Files changed

- `docs/architecture.md` — §23 "Known limitation" paragraph.
- `src/voice/transcribe.ts` — one-line comment above the in-process `withWallClock` call.
- `src/voice/ingest.ts` — empty-transcript-success now warns instead of silently dropping.
- `tests/voice/ingest.test.ts` — new test for the empty-transcript-success case.

### Verification run

- `bun test tests/voice/ingest.test.ts` — 4 pass, 0 fail, 8 expect() calls.
- `bun test tests/voice/` — 33 pass, 0 fail, 56 expect() calls (no regressions).
- `bun run typecheck` — clean.
- `bun run docs:check` — `✔ docs-check: living docs present + linked; every src subsystem
  documented.`
- `bun run lint:file -- "src/voice/ingest.ts" "src/voice/transcribe.ts"
  "tests/voice/ingest.test.ts" "docs/architecture.md"` — clean, no fixes applied.
