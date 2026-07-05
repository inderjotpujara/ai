# Slice 27 — Full multimodal I/O + uncensored (design)

**Date:** 2026-07-06
**Branch:** `slice-27-multimodal-io`
**Status:** Design — approved in brainstorming, pending spec review
**Phase:** F (Capability breadth) — pulled forward on demand
**Prereqs shipped:** Slice 20 (verified-build gate), Slice 21 (reliability/degrade), Slice 26 (managed-subprocess runtime base)

---

## 1. Summary

Activate the framework's already-typed multimodal seams into a complete **input + output** capability: the agent can **analyze** and **generate** across **text, image, audio, and video**, all local-first. A single cross-cutting **uncensored** policy axis (shipped **default-on**) makes abliterated/unfiltered models eligible and disables generation safety-checkers, across every modality.

This is the largest slice to date. It ships as one slice but executes in phases (Analysis → Image+Audio generation → Video generation → Uncensored axis), each live-verified.

### Guiding principle
Multimodal is **the existing resource model applied to new capability axes** — a media model is just a model with a capability tag, inheriting the dynamic hardware-fit selector, consent-to-pull, degrade-never-crash, and telemetry. We add capability axes and one new subsystem (`src/media/`); we do not fork the runtime, selector, or reliability layers.

---

## 2. Goals / non-goals

### Goals
- **Analyze** image (vision), audio (speech→text), and video (frames→vision) inputs.
- **Generate** images, speech/audio, and video from text (and image, for video).
- **Uncensored by default**, across all modalities, via one persisted switch driving two orthogonal mechanisms.
- **Hardware-adaptive**: models are capability-tagged candidates ranked by the existing fit selector — small model on this Mac, larger automatically on higher-end/remote hardware, **zero hardcoded model id**.
- **Media-by-reference** routing: media never crosses the router→specialist string boundary as bytes.
- Shell-native ingestion (flags + prompt-path auto-detect + macOS clipboard `--paste`).
- All standing rules: consent-before-download, degrade-never-crash, observable-by-default telemetry, all-4-docs.

### Non-goals (this slice)
- **Interactive TUI / live mid-conversation paste & drag** — that is Slice 29. This slice delivers drag-and-drop and paste via the *shell* (dropped file → path; `--paste` → clipboard image), not an interactive REPL.
- **Voice output as a conversational streaming mode** — TTS *generation* is in scope; a live streaming voice loop is Slice 28.
- **Per-run `--model` flag** — the framework has none today; media mirrors the existing model-choice UX exactly (see §7).
- **Sub-agent generate→critique→refine loops** — generation is exposed as tools; iterative refine agents can come later.

---

## 3. Locked design decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | **Mega-slice**: analyze + generate, all four modalities, incl. local video generation. | User directive; full-throttle no-deferrals. |
| D2 | **Media-by-reference** routing. Router stays text-only; forwards handle markers (`[img:a1]`) through the untouched `z.string()` delegate boundary; specialist rehydrates. | 2026 consensus (Anthropic multi-agent, Google ADK Artifacts); keeps router token cost flat, model-portable; avoids widening every signature. |
| D3 | **Hardware-adaptive via the existing fit selector.** Generation/analysis models are capability-tagged candidates with footprints; largest-that-fits wins. | Framework compute-live spine; scales up on better hardware with zero code change. Do NOT size to this Mac. |
| D4 | **Shell-native ingestion** (flags + prompt-path auto-detect + `--paste`); full interactive REPL deferred to Slice 29. | chat.ts is one-shot argv today; terminal drag-drop inserts a path, macOS clipboard image via `pbpaste`/`osascript`. Delivers real drag+paste without the TUI. |
| D5 | **Generation = tools on a `media_creator` specialist**, backed by an async job handle returning a **file handle**. | 2026 orchestration consensus (media-as-tools + async jobs + file handles). |
| D6 | **One `MediaGenerator` adapter with `ExecMode.OneShot \| Server`** reusing the Slice-26 managed-subprocess base. | Research: one adapter, ExecMode is the only real branch; one-shot = degenerate case (health = "exited 0 + wrote file"). |
| D7 | **Model choice mirrors the other flows exactly**: automatic fit-rank + provisioning download pick-list + per-role env pins. No per-run `--model` flag. | User decision; maximal consistency with chat/crew/flow (which have no `--model`). |
| D8 | **Uncensored = cross-cutting axis, shipped default-ON.** One persisted `ContentPolicy` switch drives (a) model-eligibility predicate + (b) safety-checker disable. | User directive (decided after the pushed-repo tradeoff was flagged). |
| D9 | **Our own lightweight async job+progress**, aligned in spirit with MCP Tasks (call-now/fetch-later) but NOT the wire protocol. | YAGNI for a local framework; long video jobs still need progress/cancel. |
| D10 | **Voice-cloning consent is a separate, orthogonal gate** from the content switch. | Different risk class (identity/impersonation), not content. |

---

## 4. Architecture

### 4.1 New subsystem `src/media/` — one hub, two directions

The run-scoped **media store is the hub for both analysis and generation**: analysis writes *incoming* media and hands the specialist a read handle; generation writes *outgoing* media and hands the user a result handle. Same persistence, same handle type, same telemetry surface.

```
src/media/
  types.ts            MediaKind {Image,Audio,Video}, MediaHandle, MediaItem, ResolvedMedia, FileHandle, JobHandle
  store.ts            run-scoped artifact store: persist under runs/<id>/media/, mint handle, resolve(handle), TTL prune
  resolve.ts          scan a task string for handle markers -> materialize AI-SDK v6 FilePart[] (images/frames) or transcript text
  ingest.ts           CLI input -> stored media: parse --image/--audio/--video flags (repeatable), auto-detect file paths in prompt, --paste; returns handles + prompt rewritten with [img:x]/[audio:y]/[video:z] markers
  clipboard.ts        macOS clipboard-image capture (osascript/pbpaste); degrades cleanly off-mac / when empty
  audio/transcribe.ts spawn mlx_whisper CLI -> JSON -> transcript; fallback whisper.cpp; consent-pull turbo model
  video/frames.ts     spawn ffmpeg -> adaptive-fps + scene-dedupe(0.3) + resize 768px + cap ~30-50 frames -> store frame-group handle
  generate/adapter.ts unified MediaGenerator: ExecMode.OneShot|Server (reuses runtime managed-subprocess base); returns JobHandle
  generate/image-mflux.ts   image strategy (mflux one-shot; Diffusers/ComfyUI lane for uncensored community models)
  generate/audio-mlx.ts     TTS strategy (mlx-audio server or CLI; Kokoro default; CSM/Dia behind clone-consent)
  generate/video-mlx.ts     video strategy (mlx-video LTX one-shot; ComfyUI+Wan server lane)
  policy.ts           ContentPolicy switch resolution (default ON) + uncensored-eligibility predicate + safety-checker-disable capability
```

### 4.2 Capabilities

`src/core/types.ts` `Capability` enum gains generation axes:
- `ImageGen = 'image_gen'`
- `SpeechGen = 'speech_gen'`
- `VideoGen = 'video_gen'`

Analysis reuses existing `Vision` (image + video-frame understanding); STT is a preprocessing engine (not selector-ranked by capability — a single sensible default + fallback). The selector's `hasAll` (`selector.ts:13`) is already capability-agnostic and needs no change.

### 4.3 The one narrowing point: `RunAgentInput`

`src/core/agent.ts` `RunAgentInput` gains an optional resolved-attachments field. When present, `agent.ts` calls `generateText` with `messages: ModelMessage[]` (a user message whose `content` is `[{type:'text'},{type:'file',mediaType,data}, ...]`) instead of `prompt: string`. Use `type:'file'` + precise `mediaType` (`image/png` etc.) — **`type:'image'` is deprecated in AI SDK v6.** This single change covers chat/crew/flow, since all funnel through `runAgent`.

The **delegate boundary stays `z.string()`** — untouched. The specialist's `runDefinedAgent` path scans the task for handle markers and resolves them via `media/resolve.ts` before building the `messages` array.

### 4.4 MediaGenerator adapter

```
type ExecMode = 'one_shot' | 'server';
type FileHandle = { uri: string; mimeType: string; sizeBytes: number; previewUri?: string };
type JobHandle = {
  jobId: string;                        // client-suppliable => idempotency key
  status(): JobStatus;                  // submitted|working|completed|failed|cancelled
  progress: AsyncIterable<{ fraction?: number; message: string; previewUri?: string }>;
  result(): Promise<FileHandle>;
  cancel(): Promise<void>;
};
```

- **OneShot** (mflux, mlx-video, Kokoro CLI): spawn with output path → parse stdout progress → exit-0 resolves; health = "exited 0 + wrote the file"; cancel = SIGTERM.
- **Server** (mlx-audio server, ComfyUI, Draw Things gRPC): warm → health-check → submit → stream progress → reuse; reuses the Slice-26 `managed-openai-compatible`/process-supervisor base.
- **Degrade** (Slice 21): server unhealthy → fall back to a one-shot CLI for the same kind (ComfyUI down → mflux for images); no engine progress → coarse `Working` heartbeat; fast jobs resolve synchronously.

---

## 5. Engines & model ladders (consent-pulled, license-aware, hardware-fit)

| Modality | Primary (this Mac) | Ladder / fallback | Notes |
|---|---|---|---|
| Vision (analyze) | `qwen2.5vl:7b` (Ollama) | Qwen3-VL-2B/8B | already pulled; provider encodes image parts |
| STT (analyze) | `mlx-whisper` large-v3-turbo (venv) | whisper.cpp | JSON out; ffmpeg decodes audio |
| Video frames (analyze) | ffmpeg sampler → vision | — | adaptive-fps, scene-dedupe, 768px, cap |
| Image gen | mflux + FLUX.1-schnell (Apache-2.0) | SDXL/SD3.5; Draw Things | schnell = commercial-OK default; FLUX-dev non-commercial (flag at pull) |
| Audio gen (TTS) | Kokoro-82M via mlx-audio | CSM/Dia (cloning, separate consent) | server:8000 or CLI |
| Video gen | LTX-2 int4 via mlx-video (T2V+I2V) | Wan 2.2 TI2V-5B + ComfyUI | experimental on 48GB; scales up elsewhere |

All model weights pulled via the existing consent-gated provisioning path (mflux/mlx-audio/mlx-video/whisper fetch from HuggingFace on first use — wire the repo ids into `selectModels`). License surfaced at pull.

---

## 6. Uncensored — cross-cutting axis (shipped default-ON)

### 6.1 Two orthogonal mechanisms, one switch
`src/media/policy.ts` resolves a single persisted `ContentPolicy` value (default = uncensored allowed; env/config can turn it **off**, the inverse of a normal opt-in). It drives:

1. **Model-eligibility predicate** — the uncensored model set is a *class*, not a static list (the supply regenerates constantly, e.g. the "Heretic" auto-abliteration tool). Predicate matches abliterated/dolphin/heretic/josiefied/pony/chroma-class tags. When the switch is on, these are eligible in selection across all modalities; when off, the existing selector filter (`selector.ts:29`, `allowUncensored`) excludes them.
2. **Safety-checker disable** — only Diffusers/ComfyUI ship a checker → pass `safety_checker=None` / add no checker node. mflux, mlx-audio, mlx-video, and Ollama are **filter-free by construction** → this is a documented **no-op** for those (the seam is honest about where a filter even exists).

### 6.2 Uncensored model targets (fit 48GB; mostly Ollama tag-swaps)
- Text: `goekdenizguelmez/JOSIEFIED-Qwen3:8b`
- Vision: `huihui_ai/qwen3-vl-abliterated:8b` (drop-in for qwen2.5vl; only the language head is abliterated — vision encoder unchanged)
- Image: Pony Diffusion V6 XL (SDXL-based, ComfyUI/Diffusers) + FLUX-schnell/mflux (native filter-free)
- Video: ComfyUI + Wan 2.2 (largest NSFW community ecosystem)
- TTS: Kokoro (no content filter)

### 6.3 Non-gating responsible practices (kept — none turn the capability off)
- `content_policy` telemetry attribute on runs + "uncensored mode — unfiltered output" labeling on sessions/outputs.
- Consent-before-download on model pulls (standing rule); license surfacing at pull.
- Consent/label copy states plainly: **removing content *filters* does not remove *legal* obligations.** The switch has no bearing on the two hard legal lines that hold regardless of any setting — **CSAM and non-consensual intimate imagery** — which the framework does not build toward. This is copy/labeling only: **no gate, no refusal path, no classifier.** The chosen engines do not add that capability.
- **Voice-cloning (CSM/Dia)** sits behind its own separate affirmation ("I have the right/consent to clone this voice"), orthogonal to the content switch — a different risk class (impersonation/fraud), not content.

---

## 7. Model choice (mirror the other flows exactly)

The framework has **no per-run `--model` flag** anywhere; selection is automatic fit-rank. Media mirrors this exactly:
- **Automatic** fit-rank among installed candidates (default).
- **Provisioning download pick-list** (`selectModels`, `ui/prompt.ts:51`) — the user chooses which media weights to *download*; installed weights become automatic candidates.
- **Per-role env pins** (like `AGENT_VERIFY_MODEL`): `AGENT_IMAGE_MODEL`, `AGENT_VOICE_MODEL`, `AGENT_VIDEO_MODEL`, `AGENT_VISION_MODEL`, `AGENT_STT_MODEL` — fix a role's model when set.

No new per-run selection UX.

---

## 8. Data flows

- **Vision:** `chat "what's in this?" --image ./a.png` → ingest stores `a.png`→handle, rewrites prompt with `[img:a1]` → orchestrator delegates to `vision` specialist → specialist resolves `[img:a1]`→`FilePart`, selector picks a Vision-capable model → `generateText({messages})`.
- **Audio:** transcribed **at ingest** (mlx-whisper) → transcript spliced into the prompt as text → router routes on the transcript (pure text path, no vision needed).
- **Video (analyze):** frames sampled **at ingest** → frame-group handle → vision specialist resolves `[video:v1]` to N `FilePart`s (single multi-image message when ≲8–12 frames; map-reduce summarize above that).
- **Generation:** `chat "make a poster of a fox"` → orchestrator delegates to `media_creator` → it calls `generate_image({prompt})` tool → `MediaGenerator` (mflux one-shot) → PNG → store → returns handle+path; user is told the output path. Video uses the async job handle with progress.

---

## 9. Error handling / degradation (Slice 21)

- Missing/unreadable file → clear typed error, no crash.
- Engine binary missing (ffmpeg/mlx_whisper/mflux/…) → degrade with a clear message; consent-pull where applicable.
- Model pull fails → degrade to next installed candidate (never crash), per the selector graceful-fallback contract.
- Too-big-to-fit model → fit-rank degrades to a smaller candidate or asks.
- Video job timeout / OOM → job transitions to `failed` with a message; run continues.
- Non-mac clipboard / empty clipboard on `--paste` → graceful skip with a note.
- Server engine unhealthy → fall back to a one-shot CLI for the same media kind.

---

## 10. Telemetry to emit (standing note)

New `ATTR` keys + span helpers in `src/telemetry/spans.ts` (following the OTel `gen_ai.*` conventions and the "new subsystem adds a `withXSpan`/`recordX`" rule):
- `ATTR.INPUT_MODALITY` (text|image|audio|video) on `agent.run` / model-select.
- `ATTR.CONTENT_POLICY` (default|uncensored) on runs.
- `withTranscribeSpan` (`media.transcribe`): model, durationMs, audioSeconds, outcome.
- `withFrameSampleSpan` (`media.frames`): fps, framesSampled, sceneCut count, durationMs.
- `withGenerateSpan` (`media.generate`): kind, engine, model, execMode, durationMs, sizeBytes, outcome.
- Generation model-pulls emit the existing `provision.*` spans; media selection emits the existing `agent.model.select` event with the media capability.

---

## 11. Architecture-doc update (standing note)

- **`docs/architecture.md`**: new **§22 Multimodal** (subsystem map for `src/media/`, the store-as-hub data flow for both directions, the `MediaGenerator` ExecMode adapter, the uncensored two-mechanism axis, the capability additions). Update the §4 "Four axes" capability/modality row and the §5 runtime section (generation engines reuse the managed-subprocess base). Add the doc-map/README pointer if a living doc is added.
- **`README.md`**: Status line, slice status table (Slice 27 row, ✅ Done), multimodal feature paragraph.
- **`docs/ROADMAP.md`**: flip Vision/Audio/Video (+ the folded generation + uncensored) markers to ✅ shipped, Slice 27, in the gap table, phase table, and recommended sequence.
- **The interactive architecture snapshot Artifact**: regenerate from architecture.md (new Multimodal node + edges, footer slice/test counts).

---

## 12. Testing & live-verify

### Unit / deterministic (mocked spawn)
- ingest flag + prompt-path auto-detect + marker rewrite; clipboard capture (mock `osascript`).
- store persist/resolve/TTL; handle-marker scan → `FilePart` shape (v6 `type:'file'`).
- transcribe JSON parse; frame-sampler ffmpeg arg construction; MediaGenerator JobHandle lifecycle (both ExecModes); degrade paths.
- selector picks capability-tagged media model; uncensored predicate eligibility on/off; safety-checker-disable capability wiring.
- policy switch default-on resolution; content_policy telemetry attr.

### Live-verify on this Mac (per [[feedback-live-verify-before-merge]], incl. edge cases post-review)
- Vision: real qwen2.5vl describing an image.
- STT: real mlx-whisper transcription of an audio clip.
- Video-analyze: real ffmpeg frame sampling → vision description.
- Image-gen: real mflux FLUX-schnell → PNG.
- TTS: real Kokoro → wav.
- Video-gen: a real short Wan/LTX run — **capture true M4-Pro wall-clock** (research flagged an M4-Pro-not-Max benchmark gap); verify it *runs*, not that it's fast.
- Uncensored gate: switch off → an abliterated tag is absent from selection + Diffusers keeps its checker; switch on (default) → the tag is selectable + Diffusers loads `safety_checker=None`.
- Edge cases: missing file, non-image passed as `--image`, huge video (frame cap), degrade when an engine is absent, non-mac clipboard, license flag at FLUX-dev pull, voice-clone separate consent.

### Install in-slice (Slice-18/26 pattern; spec-authorized)
`ffmpeg` (brew); `mflux`, `mlx-audio`, `mlx-video` into the venv; ComfyUI where the uncensored image/video lanes need it; consent-pull weights.

---

## 13. Phasing (one slice, staged execution)

1. **Phase A — Analysis**: `media/` store+types+resolve+ingest+clipboard, `RunAgentInput` widening, vision specialist + qwen2.5vl declaration, audio transcribe, video frames. Live-verify vision/STT/video-analyze.
2. **Phase B — Image + Audio generation**: MediaGenerator adapter (both ExecModes), image-mflux, audio-mlx, `media_creator` specialist + generate_image/generate_speech tools. Live-verify image-gen + TTS.
3. **Phase C — Video generation**: video-mlx (+ ComfyUI/Wan server lane), async job handle + progress + cancel. Live-verify a real short clip.
4. **Phase D — Uncensored axis**: `policy.ts`, eligibility predicate, safety-checker-disable capability, uncensored model declarations/catalog, content_policy telemetry + labeling, voice-clone consent, default-on wiring. Live-verify the gate.
5. **Docs + Artifact + ledger + final review + live-verify edge cases + merge.**

---

## 14. Risks / open items

- **Video-gen on 48GB is experimental** — minutes-per-clip, thin MLX-native fine-tune community; the design scales up on better hardware but this box proves the path only. Set expectations in docs.
- **ComfyUI as a dependency** for the uncensored image/video lanes is heavier than the one-shot CLIs; keep it a fallback/opt lane, not the default path.
- **First-use HuggingFace pulls** for mflux/mlx-audio/mlx-video must route through consent — confirm no silent downloads.
- **True M4-Pro video wall-clock** is unknown until the live run — do it before promising any latency.
