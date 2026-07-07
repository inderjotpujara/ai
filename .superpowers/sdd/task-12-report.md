# Task 12 report (Slice 29): Documentation (4-surface hard line)

*(Note: this path previously held a stale Slice-26 report for a
differently-scoped Task 12 — "live OAuth client provider." Overwritten here
per the file-reuse convention that report itself documented.)*

**Commit:** `8cbc37e` — `docs(slice-29): §Voice architecture + README/ROADMAP/ledger`
(4 files changed, 242 insertions, 20 deletions)

## 1. `docs/architecture.md`

- Corrected the Task-2 placeholder Mermaid `VOICE` subgraph (it had guessed
  function names — `loadTranscriber`, `captureFrames` — that don't exist in
  the shipped code) to the real files/functions: `types.ts`, `model.ts`
  (`voiceCacheDir`/`resolveVoiceModel`/`ffmpegCmd`), `capture.ts`
  (`captureFromFile`/`captureFromMic`), `transcribe.ts` (`createTranscriber`),
  `stt-worker.mjs`, `ingest.ts` (`ingestVoice`), `cli-io.ts`
  (`createCliVoiceDeps`), `scripts/setup-voice.ts`. Added data-flow edges
  (`chat`→`voiceingest`/`voicecliio`, capture/transcribe→`voicetypes`,
  transcribe→`voiceworker`/`reltimeout`/`spans`, ingest→`relledger`).
- Added a `src/voice` row to the subsystem-registry table (mirrors the
  `src/media` row's shape), pointing at the new §23 and listing its deps on
  `reliability/`, `telemetry/spans.ts`, and `media/ingest.ts` (shared
  `IngestFlags`).
- Added new `## 23. Voice input (STT) (Slice 29)` section (modeled on §22
  Multimodal): module map table for all 8 files, the mic/file→capture→
  transcribe→splice data flow (voice runs *before* media ingest in
  `chat.ts`), the two-layer capture/transcribe design + the in-process
  (default)/node-subprocess execution seam, an honest note that mic auto-stop
  uses ffmpeg `silencedetect` rather than the originally-discussed
  Silero VAD (model-free, seam-independent — a disclosed refinement, not a
  silent deviation), the full env-var block, `voice.transcribe` telemetry,
  the browser-WASM-reuse rationale for choosing sherpa-onnx, and an honest
  unit-test-vs-live-verify status (Task 13 gated, not yet run).

## 2. `README.md`

- Status line flipped: Slice 29 (CLI voice input/STT) is now the current
  **Status** block; the former Slice-28 status paragraph was relabeled
  **Previously**.
- New feature paragraph "**Voice input (Slice 29, re-scoped).**" in the
  "What it does" narrative, right after the Slice-28 paragraph.
- Added a ✅ Slice-29 row to the slice-status table.
- "Next (product line)" row retargeted from "voice input" to **Slice 30**
  (TUI / local web UI, where rich/interruptible voice lands).
- Top summary blockquote (lines ~46–55) updated: "Next: Slice 29" → "Then
  Slice 29 shipped ... Next: Slice 30."

## 3. `docs/ROADMAP.md`

- Phase-F gap table: "Voice INPUT (STT)" row flipped 🟡 re-scoped → ✅ shipped
  (Slice 29), describing what shipped (sherpa-onnx, execution seam,
  silencedetect refinement) and pointing at §23 + recommended-sequence
  item 20.
- Recommended-sequence item 20 flipped to "✅ shipped, Slice 29", keeping the
  original re-scope backstory (archived branch, reset rationale) and adding
  what actually shipped + the silencedetect-vs-VAD disclosure + the Slice-30
  hand-off (browser AEC + real hold-to-talk).

## 4. `.superpowers/sdd/progress.md`

- Appended the Task-12 ledger line (files touched, docs:check PASS).
- Appended a `## SLICE 29 SUMMARY` block: what shipped, engine/model choice,
  the 8 decisions (D1–D8) plus the silencedetect refinement, live-verify
  status (Task 13 pending), and the current suite count — **1077 pass / 30
  skip / 0 fail**.

## Verification

- `bun run docs:check` → **PASS** (`src/voice` now documented; ran again as
  the commit's pre-commit hook, also PASS).
- `bun run typecheck` → **PASS** (`tsc --noEmit`, no output/errors).

## Concerns / notes for later tasks

- Task 13 (live-verify) and Task 14 (final review + Artifact + merge) are
  still pending — the Artifact (5th, controller-owned surface) was
  explicitly out of scope for this task per the brief.
- `docs/ROADMAP.md`'s "Where we are vs. the target" prose narrative (lines
  ~27–92) was already stale before this task (it doesn't mention Slice 28
  either) — left untouched since the brief scoped only the gap-table row +
  recommended-sequence item, not that narrative section.
- Left `.remember/now.md` and the other `task-*-brief.md`/`task-*-report.md`
  files alone — they were already modified in the working tree before this
  task started (other concurrent tasks' output), not part of Task 12's scope.
