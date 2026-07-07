# Task 1 Report: Add dependency + Bun-addon de-risking spike

## Status: DONE

## What was done

Followed the task brief's 5 steps exactly (no deviations needed — the actual
package layout matched what the brief assumed).

1. **Added the dependency**: `bun add sherpa-onnx-node@1.13.4` (exact pin, per
   global constraint — sherpa ships releases very frequently).
   - Resolved version: `sherpa-onnx-node@1.13.4` (confirmed via `bun pm ls`).
   - Prebuilt platform package observed under `node_modules`:
     `sherpa-onnx-darwin-arm64` — matches the brief's assumption exactly, no
     adaptation of the spike script was required.

2. **Wrote the smoke spike**: `scripts/spikes/sherpa-bun-smoke.ts`, verbatim
   from the brief. It sets `DYLD_LIBRARY_PATH` programmatically (never relies
   on shell profile) to include `node_modules/sherpa-onnx-node` and
   `node_modules/sherpa-onnx-darwin-arm64`, then `require('sherpa-onnx-node')`
   and checks for `OfflineRecognizer`.

3. **Ran the spike under Bun**: `bun run scripts/spikes/sherpa-bun-smoke.ts`.

   Verbatim stdout:
   ```
   LOADED [
     "OnlineRecognizer", "OfflineRecognizer", "OfflineTts", "GenerationConfig", "readWave", "writeWave",
     "Display", "Vad", "CircularBuffer", "SpokenLanguageIdentification", "SpeakerEmbeddingExtractor",
     "SpeakerEmbeddingManager"
   ]
   HAS_OfflineRecognizer function
   ```
   Exit code: `0`.

   Also confirmed `node` is available on this box for the subprocess fallback
   path (not needed given the result below, but checked per the brief):
   `command -v node` → `/Users/inderjotsingh/.nvm/versions/node/v25.2.1/bin/node`,
   `node --version` → `v25.2.1`.

4. **Recorded the outcome** in `.superpowers/sdd/progress.md` under a new
   `## SLICE 29` heading (verbatim text below).

5. **Committed**: `package.json`, `bun.lock`, `scripts/spikes/sherpa-bun-smoke.ts`,
   `.superpowers/sdd/progress.md` — commit `a3510a2`
   `chore(slice-29): add sherpa-onnx-node + Bun-addon smoke spike`.

## Decision (this is the load-bearing output of Task 1)

**The sherpa-onnx-node N-API addon LOADS under Bun.** `OfflineRecognizer` is a
function, exit code 0. Per the brief's Step 3 mapping ("exit 0 → default
`inprocess`"), the default execution mode is:

```
AGENT_VOICE_EXEC default = inprocess
```

This means Task 7's `createTranscriber` should default to running the STT
core in-process (no subprocess indirection needed as the primary path). The
subprocess fallback remains available as a documented degrade path since
`node` is confirmed present on this box, but it is not the default.

## Files touched
- Modified: `/Users/inderjotsingh/ai/package.json` — added
  `"sherpa-onnx-node": "1.13.4"` to `dependencies`.
- Modified: `/Users/inderjotsingh/ai/bun.lock` — updated lockfile (adds
  `sherpa-onnx-node` + its `sherpa-onnx-darwin-arm64` prebuilt platform
  package).
- Created: `/Users/inderjotsingh/ai/scripts/spikes/sherpa-bun-smoke.ts` —
  spike script (verbatim from brief).
- Modified: `/Users/inderjotsingh/ai/.superpowers/sdd/progress.md` —
  appended `## SLICE 29` section recording the spike result.

Note: `.remember/now.md` and `.superpowers/sdd/task-1-brief.md` showed as
modified in `git status` at task start (pre-existing changes from prior
session activity, unrelated to this task) and were deliberately left
unstaged/uncommitted by this task — only the four files the brief specifies
were staged and committed.

## Deviations from the brief
None. The prebuilt dir name matched exactly (`sherpa-onnx-darwin-arm64`), so
no adaptation of `DYLD_LIBRARY_PATH` was needed.

## Ledger entry (verbatim, appended to `.superpowers/sdd/progress.md`)

```
## SLICE 29 — CLI voice input / speech-to-text (branch slice-29-voice-input-stt)
Task 1: complete. Added `sherpa-onnx-node@1.13.4` (bun add, exact pin) + `scripts/spikes/sherpa-bun-smoke.ts` (sets DYLD_LIBRARY_PATH programmatically, requires sherpa-onnx-node, checks OfflineRecognizer). SPIKE RESULT: addon LOADS under Bun (y) — `bun run scripts/spikes/sherpa-bun-smoke.ts` exited 0, printed `LOADED [OnlineRecognizer, OfflineRecognizer, OfflineTts, GenerationConfig, readWave, writeWave, Display, Vad, CircularBuffer, SpokenLanguageIdentification, SpeakerEmbeddingExtractor, SpeakerEmbeddingManager]` + `HAS_OfflineRecognizer function`. Prebuilt platform dir observed: `sherpa-onnx-darwin-arm64` (matches brief assumption exactly, no adaptation needed). node available: y (`node --version` v25.2.1 via nvm, confirms subprocess fallback is viable if ever needed, though not required now). DECISION: `AGENT_VOICE_EXEC` default = `inprocess` for Task 7's `createTranscriber`.
```

## Concerns
None blocking. Task 1 is a pure de-risking spike with no unit test to run
beyond the spike itself, per the task's framing ("no TDD unit test").

## Note
This report file previously contained a stale report from Slice 28 Task 1
(gen candidate catalog work). It has been overwritten with this task's
(Slice 29 Task 1) report above.
