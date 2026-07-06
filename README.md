# Local Agents

A **local-first, multi-agent framework** for Apple Silicon. Build and run AI
agents against **local models** (no API keys), orchestrated by a super-agent,
on your own machine — today on a laptop, soon full-throttle on a dedicated Mac
Mini.

> **Where this is going:** a local-first, self-owned **n8n × CrewAI** — an
> agent-workflow platform where you compose role-based agents + tools into
> workflows, trigger them, watch them run, and let the system extend itself with
> new agents on demand. Slices 1–7 built the hardware-aware **engine**; the
> product line is now underway — Phase A's run-viewer (Slice 8) and Phase B's
> composition guardrails (Slice 9), workflow/DAG engine (Slice 10), crews &
> roles (Slice 11), memory/RAG (Slice 12), grounded verification (Slice 13),
> first-boot model provisioning (Slice 14), a declarative MCP mount
> registry + starter pack (Slice 15), an MCP telemetry-ordering fix +
> consent robustness hardening (Slice 16), Phase D's **agent-builder**
> (Slice 17) — describe a capability gap, review a proposal, and the system
> writes a new specialist — a **debt wrap-up + MLX completion** slice
> (Slice 18), a **crew/workflow builder** (Slice 19) — describe a
> *multi-step* need and the system composes existing **and** freshly-built
> agents into a reviewed crew or workflow — and the **verified "works out of
> the box"** pass (Slice 20) — every generated artifact is reuse-checked,
> staged, execution-dry-run, and golden-evaled before it may commit — have
> landed, **completing Phase D (self-extension)**, **graceful degradation
> + retries** (Slice 21) fills Phase A's last **reliability** gap — a dead
> MCP server, model, or tool no longer sinks a run; it degrades and tells the
> user — **alternate runtimes + remote-auth completion** (Slice 26)
> raises **LM Studio and llama.cpp to full inference runtimes** alongside
> Ollama and MLX (a shared managed-runtime base with per-runtime
> relaunch/reload/fixed context handling) and completes **live remote MCP
> OAuth** (DCR, browser handshake, on-disk token persistence) plus a
> verified **GitHub-PAT** remote server — and **full multimodal I/O +
> uncensored** (Slice 27, Phase F, pulled in on demand) adds vision/audio/video
> **input** (describe an image, transcribe speech, sample+describe video
> frames — all media-by-reference, never raw bytes through the router),
> text→image/speech/video **generation** (a new `media_creator` specialist),
> and a default-**on** uncensored content-policy axis (model eligibility +
> safety-checker disable). Vision/STT/frames/image-gen/speech-gen/uncensored
> are all live-verified on real hardware; **video generation's dependency
> conflict is resolved** (an isolated venv via `bun run setup:media`) **and
> its CLI arg-correctness is live-verified** against the real `mlx-video`
> CLI — a full render is disk-bound on the dev Mac (LTX-2 is a 19B model,
> not enough free disk here), the framework's hardware-adaptive
> scales-on-a-bigger-box case, not a code gap. (Phase A's one
> remaining open item is the routing-accuracy eval harness.) Next: **Slice 24**
> (always-on daemon + secure remote access, Phase E — Slices 22/23 are
> deferred/held). See [`docs/ROADMAP.md`](docs/ROADMAP.md).

> **Status:** Slice 27 complete — **Full multimodal I/O + uncensored** (Phase
> F, pulled in on demand ahead of the daemon per user direction — the same
> out-of-numeric-sequence pattern Slice 26 used). A new `src/media/`
> subsystem, built on one design principle throughout: **media-by-reference,
> not media-by-value** — a run-scoped `MediaStore` mints a short opaque handle
> (`img_1`/`aud_1`/`vid_1`) for every piece of media, and only a
> `[img:h]`/`[audio:h]`/`[video:h]` marker travels through the router and the
> delegation boundary (`z.string()` untouched); the specialist that actually
> needs the bytes resolves the handle at the last moment, right before the
> model call. **Input (analysis):** `--image`/`--audio`/`--video` CLI flags
> (repeatable) + prompt-embedded path auto-detection + macOS `--paste`, each
> degrading independently (a bad path is skipped + warned, never aborts the
> turn); audio is transcribed immediately via `mlx-whisper` and spliced into
> the prompt as text; video is frame-sampled via `ffmpeg` into a handle-group;
> images and video frames resolve to AI-SDK v6 `FilePart`s (base64, per a
> live-verify finding that Ollama's `images[]` rejects a raw `Uint8Array`) for
> the new **`vision`** specialist (`qwen2.5vl:7b`, selected through the
> existing hardware-fit selector like any other capability). **Generation:**
> a `MediaGenerator` job adapter (`ExecMode.OneShot|Server`, cancel-race-safe,
> wall-clock-timeout-guarded) backs three default engines — **mflux** (image,
> via an ungated FLUX-schnell mirror since the obvious default is
> HuggingFace-gated), **Kokoro/mlx-audio** (speech), **LTX/mlx-video**
> (video) — exposed as `generate_image`/`generate_speech`/`generate_video`
> tools on a new **`media_creator`** specialist; a ComfyUI/Wan server-lane
> strategy exists but is shape-only (ComfyUI isn't installed). **Uncensored**
> is a cross-cutting axis, shipped **default-ON**: two orthogonal mechanisms —
> a model-eligibility predicate (an agent/env can still opt out) and a
> Diffusers/ComfyUI-lane safety-checker disable (a no-op on the filter-free
> mflux/mlx-audio/mlx-video engines) — plus `content_policy` telemetry on
> every run and a fail-safe voice-clone consent gate (orthogonal, for
> cloning-capable TTS models only). New `Capability.ImageGen/SpeechGen/VideoGen`
> type the taxonomy for future selector-routed generation (not yet consumed —
> generation is currently routed structurally by media kind, not the
> selector). New `INPUT_MODALITY`/`CONTENT_POLICY` telemetry attrs +
> `media.transcribe`/`media.frames`/`media.generate` spans. **Live-verified on
> this Mac:** vision (real `qwen2.5vl`), STT (real `mlx-whisper`), video
> frame-sampling (real `ffmpeg`), image generation (real `mflux`, a
> controller-viewed PNG), speech generation (real Kokoro — `misaki[en]` is
> auto-installed by `bun run setup:media`), and uncensored (pulled and ran a
> real abliterated model). **Video *generation*:** the earlier `mlx-video`
> ↔ `transformers` dependency conflict is **resolved** via an isolated video
> venv (`bun run setup:media`, `transformers==5.5.0` pinned after the
> `mlx-video` install), and the strategy's **CLI arg-correctness is
> live-verified** against the real `mlx_video.ltx_2.generate` CLI (caught +
> fixed a real bug — `-n` → `--num-frames`, plus a required `--pipeline`,
> `AGENT_VIDEO_PIPELINE`-overridable). A **full render is disk-bound on the
> dev Mac** (LTX-2 is a 19B model, ~100 GB full repo, vs. ~90 GB free here) —
> the framework's hardware-adaptive "scales on a higher-disk box" case, not a
> code defect; the code (`ltxStrategy`, the tool, the server-lane degrade
> path) is complete, unit-tested, reviewed, and now CLI-verified. See
> [`docs/architecture.md`](docs/architecture.md) §22.

> **Previously:** Slice 26 — **Alternate runtimes + remote-auth completion**
> (debt slice, gated on installing those runtimes / having creds — landed out
> of sequence per that gate). Stood up **LM Studio and llama.cpp as full
> inference runtimes** alongside Ollama and MLX via a shared managed-runtime
> base (`createManagedRuntime(strategy)`, spawn/health-poll/kill-on-timeout,
> per-runtime relaunch/reload/fixed context handling) and completed **live
> remote MCP OAuth** (DCR, browser handshake, on-disk token persistence) plus
> a verified **GitHub-PAT** remote server; live-verified on this Mac across
> all three managed runtimes, both download adapters, GitHub-PAT, and a full
> Linear OAuth handshake. See [`docs/architecture.md`](docs/architecture.md)
> §5 / §14.

> Also previously: Slice 21 — **Graceful degradation + retries** (fills
> Phase A's last reliability gap; the routing-accuracy eval harness remains
> open). One canonical `src/reliability/` layer — a three-lane
> error taxonomy (`Lane.Transient/RouteWorthy/Terminal`), retry with
> full-jitter backoff + `Retry-After` respect, run/idle timeouts, a
> hand-rolled circuit breaker (shared registry keyed by dependency id), a
> failure-domain-aware model-degradation chain, and a user-facing
> `DegradationLedger` — is now wired into delegation, the workflow engine,
> crews, MCP tool calls, and the model selector: a dead dependency **drops
> that agent/step and tells the user** (printed summary + persisted
> `run.dir/degradation.jsonl` + `reliability.*` telemetry) instead of
> silently failing or sinking the run. The pre-existing provisioning
> stall/retry guards and the verified-build wall-clock primitive were
> migrated onto the same layer, closing 8 places that used to duplicate
> retry/timeout logic. Per D5 (AI SDK v6 already retries LLM-call transport
> errors), the LLM turn itself is never double-retried — only cross-boundary
> operations the framework owns (MCP calls, downloads, runtime probes) get
> `withRetry`. **Live-verified on real Ollama** (4 scenarios,
> `tests/integration/reliability-live.test.ts`, `RELIABILITY_LIVE=1`): an
> unreachable MLX runtime degrades to a real Ollama fallback model that
> actually generates, a Tool step that fails once then succeeds is retried to
> completion, a delegated agent whose model call fails returns a structured
> error without crashing the run, and a real `withMcpRun` persists
> `degradation.jsonl` + a `reliability.degrade` span event. See
> [`docs/architecture.md`](docs/architecture.md) §21. Also shipped: Slice 20
> (**Verified "works out of the box"**, Phase D — closes the phase — every
> agent-builder/crew-builder write becomes stage→verify→commit: a
> pre-generation reuse check against a per-registry manifest, an execution
> dry-run against a benign representative task with a bounded self-repair
> loop, a golden-eval judged by the largest installed model, and usage
> aggregation + a reversible archive flow), Slice 19 (**Crew/workflow
> builder**, Phase D — a multi-step need becomes a
> reviewed crew or workflow via a staged declarative-IR pipeline, a two-tier
> structural+semantic gate, consent-gated auto-build of missing member
> agents, and a deterministic transpiler; live-verified end to end — a
> generated crew was written *and executed* to a correct result), Slice 18
> (**Debt wrap-up + MLX completion** — the download/inference enum split,
> `hf-fetch` real disk persistence, the MLX runtime raised to Ollama's bar
> and live-verified both ways, provisioning polish, and MCP/agent-builder
> debt), Slice 17 (**Agent-builder**, Phase D — describe a need, review a
> proposal, and the system writes a reviewed specialist, live on the next
> run), Slice 16 (MCP telemetry-ordering fix
> + consent robustness — `mcp.mount` now lands in `runs/<id>/spans.jsonl`,
> consent judged on stdin **and** stderr TTY), Slice 15 (`mcp.json` mount
> registry + starter pack, `src/mcp/`, 12-entry curated pack, consent-gated +
> tool-definition-pinned mounting), Slice 14 (first-boot provisioning +
> runtime-agnostic downloader, Ollama live-verified; LM Studio/llama.cpp/MLX
> contract-tested at the time, live-verify completed in Slice 26), Slice 8
> (OTel run-viewer, `bun run
> runs`), Slice 9 (composition guardrails — delegation depth limit +
> return-size cap), Slice 10 (workflow/DAG engine, `bun run flow <name>`),
> Slice 11 (crews & roles, `bun run crew <name>`), Slice 12 (memory/RAG,
> `bun run memory ingest|recall|stats|reindex`), and Slice 13 (grounded
> verification, `--verify`). See [Roadmap](#roadmap).

---

## What it does (today)

```sh
# Ask a question about a local file. The agent reads the file via a tool and answers.
bun run src/cli/chat.ts "What animal is mentioned in /tmp/sample.txt?"
```

Under the hood, one CLI run autonomously:

1. **Checks the memory budget** — computes the live budget
   (`min(75% × Metal cap, 80% × available RAM)`, recomputed each delegation),
   estimates the model's footprint, and confirms it fits.
2. **Ensures the model is present** — pulls the chosen specialist model (e.g.
   `qwen3.5:9b`) if it isn't installed (no hardcoded download step you have to run).
3. **Warms the model** into memory.
4. **Runs the agent loop** — the model calls a `read_file` tool (exposed over
   **MCP**) and composes an answer.
5. **Records the run** — writes the answer and an append-only journal to
   `runs/<id>/`.
6. **Unloads the model** to free memory.

No manual steps. No API keys. Everything runs locally.

**Dynamic model selection (Slice 5).** Specialists declare a *capability requirement* (`requires: [tools]`, `prefer: largest-that-fits`) rather than a fixed model. At each delegation the selector picks the largest registry model that fits the **live** memory budget (degrading 9b→4b under pressure), prints a one-line notice (size · context · footprint · installed/pulling · budget), and the Model Manager loads it. If nothing fits, the run ends with an honest `resource` message and a non-zero exit instead of a hallucinated answer. The registry is a machine-adaptive bootstrap ladder populated at runtime by Slice 6 discovery.

**Model discovery (Slice 6).** `bun run discover` fetches the latest tool-capable GGUF (and MLX, when a local MLX server is running) models from Hugging Face (trusted publishers, sized to your live RAM budget), writes a per-machine `model-images/catalog.json`, and pre-pulls the top fitting model. Normal `chat` runs read an **offline** merge of the bootstrap rungs + locally-installed models + the cached catalog — no network needed. A local MLX server (LM Studio / vllm-mlx at `MLX_BASE_URL`) is discovered + used automatically when running. Vision/audio/video and an uncensored mode are typed-in seams shipped in later slices.

**KV-cache quantization (Slice 7).** Start with `bun run serve` (sets `OLLAMA_FLASH_ATTENTION=1` + `OLLAMA_KV_CACHE_TYPE`, default `q8_0` — flash attention is *required* and not auto-enabled on Apple Silicon). KV cache type is **global** (Ollama limitation), but the manager sizes context **per-model from each model's live architecture** (`/api/show`), so q8_0 yields ~2× context (near-lossless on tolerant architectures) and a generalized advisory warns when an *arch-risky* model (small head_dim / MoE) runs under a quantized cache. Override with `AGENT_KV_CACHE_TYPE=f16|q8_0|q4_0`.

**Run-viewer / OpenTelemetry telemetry (Slice 8).** Every run is instrumented as an **OpenTelemetry trace** — root, delegation, and model-lifecycle spans written to `runs/<id>/spans.jsonl`. `bun run runs` lists recent runs, `bun run runs <id>` renders the trace as a terminal timeline, and `bun run runs <id> --follow` tails it live. The exporter is swappable: point `AGENT_OTLP_ENDPOINT` at any OTLP-compatible backend (Jaeger, Tempo, Phoenix, Honeycomb) to get the same signal there with no re-instrumentation. The underlying `src/telemetry/` layer is the shared seam every later subsystem (guardrails, workflows) emits spans into.

**Composition guardrails (Slice 9).** Prerequisites for safe multi-agent depth, enforced via an `AsyncLocalStorage`-based delegation context: a **depth limit** (default 5, guarantees termination, override `AGENT_MAX_DELEGATION_DEPTH`; recursion within the limit is allowed) and a **live return-size cap** (¼ × the calling model's `num_ctx`, override `AGENT_RETURN_CTX_FRACTION`) so a sub-agent can't blow the caller's context budget. Violations surface as soft errors plus an `agent.guardrail.violation` span event rather than a hard crash.

**Workflow / DAG engine (Slice 10).** A second, deterministic orchestration mode alongside the LLM router: `defineWorkflow({id, steps})` builds a code-first, typed, JSON-serializable DAG out of `agent` / `tool` / `branch` / `map` (bounded fan-out) steps, with Zod-validated structured I/O flowing between them. Execution is fail-fast by default, with a per-step `onError: 'continue' | {fallback}` escape hatch. Run one with `bun run flow <name>`; workflows live in the `workflows/` registry and are executed by `runWorkflow()`. Agent steps reuse the Slice 9 guardrails via a shared `runGuardedAgent`, and the engine emits `workflow.run` / `workflow.step` spans into the same telemetry layer. See [`docs/architecture.md`](docs/architecture.md) §9.

**Crews & roles (Slice 11).** A CrewAI-style role/task/process layer composed on top of the existing workflow engine and orchestrator — not a new engine. `defineCrew({id, members, tasks, process})` is validated at construction (unique names/ids, member/dependency resolution, acyclic task graph). **Members** are `{role, goal, backstory, requires, prefer, tools?}` — role/goal/backstory compose into the system prompt, and the model is resolved live by the selector (largest-that-fits), same as any other agent. **Tasks** are `{description, expectedOutput, member, dependsOn?, output?}` with optional Zod-typed output; `dependsOn` forms context edges between tasks. Two **processes**: `sequential` compiles the crew to a Slice-10 workflow DAG and runs it on the existing engine, and `hierarchical` reuses the orchestrator with an auto manager (model defaults to the router). Crew runs reuse the Slice 9 guardrails via `runGuardedAgent` and emit `crew.run` / `crew.step` (`crew.task.member`) telemetry. Run one with `bun run crew <name> [input...]`; crews live in the `crews/` registry (ships a `research-crew` example: researcher → writer, sequential). Live model selection — largest-that-fits, computed at run time — is now wired into both the `flow` and `crew` CLIs via a shared `src/cli/select-runtime.ts`. See [`docs/architecture.md`](docs/architecture.md) §10.

**Memory / RAG (Slice 12).** A persistent semantic memory layer, `src/memory/`, composed on top of the Model Manager (weights-only embedder loading), the guardrails delegation context (injection budget), and telemetry — not a new resource mechanism. A two-tier store: **LanceDB** (embedded vector DB, one table per named *space*) + **`bun:sqlite`** (a space registry that's the authority for that space's embedder+dimension, and a `(space, source)`-scoped document ingestion manifest so re-ingesting an unchanged file is a no-op). Default embedder `qwen3-embedding:0.6b`. Retrieval is **dense vector search today** (an FTS index is created opportunistically but hybrid BM25+dense fusion isn't wired up yet) → an **optional cross-encoder rerank, on by default** (`transformers.js`/ONNX, `Xenova/bge-reranker-base` — the viability spike passed on Apple Silicon; disable with `AGENT_MEMORY_RERANK=0`; a reranker failure degrades gracefully to the pre-rerank order rather than crashing) → a live budget-fit pack sized off the caller's `num_ctx`. Results are citation-tagged (`[mem:<id>]`) and recall abstains explicitly (`"No supporting memory found."`) rather than fabricating — the two anti-hallucination primitives that Slice 13's verification layer builds on. Drive it directly with `bun run memory ingest|recall|stats|reindex`, or opt a crew/workflow into a bound `recall` tool + auto-persisted task/step output via an optional `memory` dependency. See [`docs/architecture.md`](docs/architecture.md) §11.

**Grounded verification (Slice 13).** An anti-hallucination layer, `src/verification/`, built directly on Slice 12's citation tags and abstention primitive — not a new engine. `verify()` decomposes an answer into atomic claims, fetches **exactly the memory chunks each claim cites** (`getByIds`), and checks every claim against its own cited evidence with **`bespoke-minicheck`** — a small model fine-tuned for `(document, claim) → supported?` fact-checking, distinct from the general/router model that still handles decomposition and retrieval grading. The judge model is **consent-pulled** on first use (prompted interactively, or `AGENT_VERIFY_AUTO_PULL=1`/`0` to force); if it's unavailable, verification falls back to the general model rather than hard-failing. A **bounded Corrective RAG** step (grades retrieval and, if weak, rewrites the query and re-answers; re-retrieval happens when a `recall` dependency is wired — the current `--verify` CLI path re-answers without fresh retrieval, a documented follow-up) runs once by default before the final gate; if the answer still isn't faithful (`faithfulness < 0.9` by default), the system **abstains** — `{kind:'unverified'}` — instead of presenting an unsupported draft. It's opt-in and additive: flag a task/crew/workflow `verify: true`, or pass `--verify` to `bun run crew <name>`/`bun run flow <name>`, and the compiler splices a verify→branch→corrective→abstain sub-graph after the answering step (`StepKind.Verify`); everything else compiles unchanged. An abstention writes `runs/<id>/unverified.txt` and exits non-zero. Designed for the **terminal** answering step of a run — a documented limitation, not yet per-mid-step. The eval gate is an **in-repo golden set** (~20 cases), no external framework. See [`docs/architecture.md`](docs/architecture.md) §12.

**First-boot provisioning (Slice 14).** A first-boot / on-demand model provisioning layer, `src/provisioning/`, that gets weights onto disk without manual `ollama pull`s — it does not replace the Model Manager; provisioning just makes sure the bytes are present for `ensureReady` to pick up on the next normal run. `bun run provision` runs the flow: detect the host → discover fitting models (a dynamic per-runtime catalog query, degrading per-source to a committed `snapshot.json` on a throw or empty result) → `fitAndRank` by hardware fit → **per-model consent** (recommended pre-selected, nothing downloads without an explicit yes) → a disk-space preflight + stall/retry supervisor guards (`checkDiskSpace`, `withRetry`, `StallWatchdog`) → sequential downloads through a runtime-agnostic `DownloadProvider` with one live progress bar, each model's failure caught individually so one bad pull never aborts the rest. Adapters exist behind that interface: **Ollama is live-verified end-to-end** (a real pull to 100%, idempotent re-provision); **the shared HuggingFace fetcher (llama.cpp GGUF + MLX snapshot) is now download-complete and live-verified** (Slice 18 — atomic disk-write + HF-LFS-oid verify, real MLX-snapshot pull); **LM Studio's download adapter is wired into `providerFor` (under its own `ProviderKind.LmStudio` since the Slice 18 enum split) and live-verified in Slice 26** (`ALTRUNTIME_LIVE=1`; the live pass fixed its download poll-URL). Degrade-never-crash applies per catalog source and per model. A non-invasive, TTY-gated `chat.ts` auto-detect hook offers the same flow when a declared model is missing, and the run emits an `agent.model.provision` telemetry span (candidate/selected/byte counts, downloaded/failed outcome). See [`docs/architecture.md`](docs/architecture.md) §13.

**MCP mount registry & starter pack (Slice 15).** Slice 3's two hardcoded mounts (`createFileTools`/`createFetchTools`) are replaced by a **declarative registry**, `src/mcp/`: a committed `mcp.json` (the standard `mcpServers` shape, plus a per-server `agents` field for scoping) is read by `loadMcpConfig()` (per-entry degrade — a bad entry warns and is skipped, one needing an unset env var goes `dormant`) and mounted by `mountAll()`. Every mount is **consent-gated** — a TTY prompt shows the exact command/URL before it runs (or `AGENT_MCP_AUTO_APPROVE=1` for headless/CI), and its tool definitions are **hashed and pinned** so a server that changes its tools after approval (a "rug-pull") gets caught and re-prompted rather than silently trusted. A **12-entry curated starter pack** — `bun run mcp list|status|add <name>` — covers files (`file-tools`, `filesystem`), SQL (`sqlite`, SELECT-gated `query` + `execute`), memory, sequential-thinking, web-fetch, git, time, browser (Playwright), GitHub, and web-search (Brave/Exa); key-gated entries stay dormant until their env var is set. A live eval (`tests/mcp/eval-scoping.test.ts`) checks that a `file_qa`-scoped agent reliably picks `read_file` over a merged toolset's distractors. See [`docs/architecture.md`](docs/architecture.md) §14.

**MCP telemetry-ordering fix + consent robustness (Slice 16).** Slice 15 wired an `mcp.mount` span around every mount pass, but each CLI's `main()` mounted **before** creating the run dir/telemetry provider, so the span was recorded against the OTel no-op default and never reached `runs/<id>/spans.jsonl`. A new `src/cli/with-mcp-run.ts` fixes this by owning the whole per-run CLI scope in one place — `createRun` → `initRunTelemetry(run.dir)` → `withMcpMountSpan(mountAll(...))` → the run body → `finally { registry.close(); telemetry.shutdown() }` — so `mcp.mount` now lands alongside every other span. The mount span also gains a `mcp.server.count` attribute and a corrected `mcp.tool.count` (now the sum of mounted servers' tool counts, not a raw record count). Separately, interactive consent prompting now requires **both** stdin and stderr to be TTYs (`interactiveTTY()`) — judging on stderr alone let a piped-in run (`bun run flow ... < /dev/null`) hang on an already-ended stdin — and `stdinInput()` resolves `''` on stream `end` instead of leaving the read promise pending. See [`docs/architecture.md`](docs/architecture.md) §14.

**Agent-builder (Slice 17, Phase D).** The first self-extension slice: `src/agent-builder/` turns *"describe a need"* into a working specialist. `generateProposal` drafts a snake_case name/description/system-prompt/rationale from the need (inserted as `<need>…</need>` **delimited data**, never instructions, to blunt prompt injection); `suggestServers` picks the minimal MCP-server subset from the Slice 15 `STARTER_PACK` — **palette-only**, anything the model invents is dropped; `validateProposal` is a pure structural gate (unique snake_case name, non-empty fields, palette-only + correctly-scoped servers) that runs **before** consent is ever asked; `writeAgent` then atomically renders `agents/<name>.ts`, inserts one import + registry line into a new `agents/index.ts` **registry** (`AGENTS: Record<name, AgentFactory>` + `agentNames()` — `super.ts`/`chat.ts`/`flow.ts` now build their agent set from it instead of hardcoding factories) at marker comments, and scopes any suggested servers into `mcp.json` (deep-cloning pack entries so it never mutates the shared `STARTER_PACK`). `buildAgent` sequences generate→suggest→validate→consent→write under a new `agent.build` telemetry span (`agent.build.need`/`.outcome`/`.agent_name`/`.server_count`). Two triggers: `bun run agent-builder "<need>" [--yes]`, and a TTY-gated offer when `chat.ts` hits a `{kind:'gap'}` outcome (that outcome and its `agent.gap.missing_capability` attribute are unchanged — the offer is a purely additive branch). Safety model: **review-before-activate** (consent is mandatory, no bypass in the chat path), **palette-only tools**, **no same-run activation** (a written agent is live on the *next* run), and — through Slice 17 — no tool-code generation and no OAuth (both revisited in Slice 18). See [`docs/architecture.md`](docs/architecture.md) §18.

**Debt wrap-up + MLX completion (Slice 18).** A single slice discharging the dischargeable-now deferred debt logged through Slice 17, centered on MLX. **Enum split:** `src/core/types.ts` now carries a download `ProviderKind` (`Ollama`/`HfGguf`/`HfSnapshot`/`LmStudio`) separate from an inference `RuntimeKind` (`Ollama`/`MlxServer`/`LmStudio`), bridged by `src/core/kind-map.ts` (`downloadKindFor`/`runtimeKindFor`); `ModelDeclaration` carries `runtime`, a provisioning `Candidate` carries both. **HF-fetch real disk download:** `src/provisioning/providers/hf-fetch.ts` now persists bytes — atomic `.part`→rename for a single-file GGUF and whole-tree enumeration for an MLX snapshot, HF-LFS-`oid` verify-when-present else compute-and-record, a `safeJoin` traversal guard, write-stream-error→`ProviderError`, and `withRetry`+`StallWatchdog` parity with Ollama. **MLX runtime:** `createMlxServerRuntime` fills the OpenAI-compatible control surface (`getModelMax`/`listLoaded`/best-effort `pull`, honest `undefined`/no-ops elsewhere); MLX is selected **opt-in** via a declaration's `runtime` and **degrades to Ollama** (using `fallbackModel`) when the server is unreachable, emitting `model.runtime.selected`/`.degraded`. **Provisioning polish:** TTY-gated bounded-parallel downloads (`DOWNLOAD_CONCURRENCY=2`) with a `MultiProgressBar`, truthful `provision.snapshot_fallback`/`.runtime`/`.deferred_verify` telemetry, a `bytesPerWeight` 0.56→0.6 bump + an injectable Metal reader (`AGENT_METAL_WORKING_SET_BYTES`), and a manual `scripts/refresh-snapshot.ts`. **MCP + agent-builder debt:** `mcp.transport` telemetry, an engine-enforced read-only sqlite gate (`PRAGMA query_only`, which also allows `WITH…SELECT` CTEs), an atomic `addPackEntry`, `warnUnknownAgents` in chat, MCP OAuth `authProvider` (contract-tested), an agent-builder same-run bounded retry, and a consent-gated tool-code path that writes an **inert `<name>.proposal.ts`** (no same-run activation). **Live-verified both ways** — real `mlx_lm.server` inference and a real HF-snapshot download, plus an Ollama regression pass. (LM Studio / llama.cpp as full *inference* runtimes and the live OAuth handshake — listed as deferred here — both **shipped in Slice 26**; only the TS-SDK-v2 / AI-SDK-v7 migration remains, held as Slice 23.) See [`docs/architecture.md`](docs/architecture.md) §5/§13/§14/§18.

**Crew/workflow builder (Slice 19, Phase D).** Self-extension one level up from Slice 17: `src/crew-builder/` turns a plain-language **multi-step** need into a working **crew** (CrewAI-style role/goal/task team, `sequential` or `hierarchical`) or **workflow** (a raw DAG covering all 4 directly-planned `StepKind`s — agent/tool/branch/map; `Verify` is reachable only via a step's `verify` flag), composing **existing and freshly-built** agents. Generation is staged, not one-shot: `classify` (crew vs workflow) → `analyze` (**think-first**, prose-only) → `plan-nodes` → `plan-edges` assemble a declarative, JSON-safe **IR** (`CrewIR`/`WorkflowIR`, Zod-validated) — never a `CrewDef`/`WorkflowDef` directly, since those carry live closures and aren't serializable. Step inputs, branch predicates, and map sources are expressed as a small **safe-helper vocabulary** (`fromInput`/`fromStep`/`fromTemplate`/`whenEquals`/`whenContains`/`whenTruthy`/`mapOver`) — the only closures a model can pick from, never invent. A **two-tier validation gate** (`validate.ts`) checks structure first (refs resolve, tools are palette-only, the graph is acyclic via a shared `assertAcyclic` now extracted into `workflow/define.ts`) and only then asks an LLM judge whether the graph actually accomplishes the need. After consent, `resolve-members.ts` **auto-builds any genuinely-missing member agents** by delegating to the Slice-17 agent-builder (its own per-agent consent), reconciling any renamed refs; a deterministic, model-free `transpile.ts` then renders the IR to real `crews/<id>.ts`/`workflows/<id>.ts` TS (every string `JSON.stringify`'d), and `write.ts` writes it + a registry entry atomically. `CrewMember` gained an optional `agentRef` (`src/crew/types.ts`) so a crew member can reuse a registered — or just-built — agent, resolved by `crewAgentMap` (`src/crew/engine.ts`). Two triggers: `bun run crew-builder "<need>" [--yes]`, and a TTY-gated `chat.ts` offer (`shouldOfferCrew`'s multi-step heuristic, tried before the existing single-agent offer). Safety model mirrors the agent-builder: review-before-activate, palette-only tools, per-agent auto-build consent, no same-run activation. **Live-verified end to end on Ollama** — a generated crew was written and then actually **executed** (`runCrew`) to a correct result, the first live run of this pipeline, which surfaced and fixed 4 real defects (a nested-schema key-hint gap in the shared `BuilderModel` seam, under-specified IR prompt constraints, a regeneration loop that didn't catch a throw, and a tool-name/`ToolSet` type mismatch). `crew.build` telemetry span. See [`docs/architecture.md`](docs/architecture.md) §19.

**Verified "works out of the box" (Slice 20, Phase D — closes the phase).** Generation used to be write-then-return: a proposal/IR passed structural (and, since Slice 19, semantic-judge) validation and landed in the registry without ever being run. `src/verified-build/` turns every agent-builder/crew-builder write into **stage → verify → commit** through one shared, cheapest-first gate (`verifyAndCommit`). Before anything is generated, a **reuse check** distills the need into a capability signature, embeds it, and cosine-compares it against a per-registry **manifest sidecar** (`<registry>/.generated.json` — which now persists each generated artifact's original need, signature+vector, verified level, golden path, and usage counters): **≥0.85 → ask to reuse** the existing artifact (accept → nothing is generated; decline → generate), **0.75–0.85 → offer** the close match and ask reuse-or-build, **<0.75 → generate**; the non-interactive `--yes` policy auto-reuses a Reuse hit but declines an Offer hit. After consent, the artifact is **staged** (a def file on disk, never the registry index), re-checked structurally, then **actually executed** against a benign read-only representative task (`dry-run.ts` — every run is `withWallClock`-raced; the agent path additionally aborts in flight via a new `runAgent` `abortSignal` seam, while crew/workflow runs are wall-clock-raced only since `runCrew`/`runWorkflow` take no signal yet), with a bounded **self-repair loop** (≤2 attempts, the real runtime error fed back into a fresh regeneration — the agent-builder re-drafts with the error as retry feedback, the crew-builder re-plans with it appended — keeping the consented name/id). A **golden-eval** then auto-decomposes the need into 3–7 binary cases and judges each artifact output with the **largest installed model (~26–30b), preferring a different family than the generator** (falling back to same-family/largest); each case requires a unanimous yes over 3 judge runs, with grounded-kind cases routed through the verification layer's `checkClaim`; if no installed model clears the ~24B-parameter judge bar, the behavioral eval is **skipped and the commit is marked `verified: runs`** — degrade, never block, never an unconsented pull. Only a passing (or explicitly `--force`d/`verify.force`d, marked `unverified` with a WARNING) gate reaches **commit**: the registry-index splice, a `<name>.golden.json`, and the manifest upsert; a failed gate registers nothing and the staged file is discarded. On top of the manifest: **usage aggregation** derived from every run's `spans.jsonl` (no new bookkeeping) and a **reversible archive** flow — `bun run archive [--prune]` reports (and, per-candidate consent, archives to `<registry>/archive/`) artifacts that are idle *and* have a more-used near-duplicate — plus an informational reuse hint on chat's gap offers. `build.verify` / `build.archive` telemetry spans. See [`docs/architecture.md`](docs/architecture.md) §20.

**Alternate runtimes + remote-auth completion (Slice 26).** Declaring `runtime: RuntimeKind.LlamaCpp` or `RuntimeKind.LmStudio` on a model now runs real inference, not just a download: `src/runtime/managed-openai-compatible.ts`'s `createManagedRuntime(strategy)` is the shared implementation behind both, plus a rewritten `mlx-server.ts`. llama.cpp **relaunches** `llama-server -c <numCtx>` to change context (or `-hf <org/repo>` when the model looks like an HF repo id rather than a local path); LM Studio **reloads** the model via `@lmstudio/sdk`'s `client.llm.load(model,{config:{contextLength}})` against its always-on daemon; MLX's context is **fixed** (`mlx_lm.server` has no context flag) — a requested window is honestly never applied rather than silently ignored. All three are spawn/health-polled/kill-on-timeout-supervised by `process-supervisor.ts` (a fresh free port every relaunch) and circuit-breaker-wrapped per runtime kind. `select-hook.ts` now calls `rt.control.warm(model, numCtx)` for every non-Ollama runtime so a resolved context actually reaches the process. Separately, MCP OAuth is now **live**, not contract-tested-only: `src/mcp/oauth-provider.ts`'s `createOAuthProvider` is a real `@ai-sdk/mcp` `OAuthClientProvider` (Dynamic Client Registration, PKCE, a CSRF `state` nonce, a browser-loopback redirect capture, and authorization-server metadata persistence), backed by a `token-store.ts` atomic **0600** on-disk store; `with-mcp-run.ts` now actually constructs one per `auth.kind: oauth` config entry (previously always empty, so OAuth silently degraded every time), and `mcp/client.ts`'s `mountMcpServer` completes the handshake the first time a server is used. Live-verified on real hardware: llama.cpp, LM Studio, and MLX all serving inference; a GitHub-PAT remote server; and a full Linear OAuth handshake (DCR → browser → token exchange → 47 tools, with silent token-reuse on a second run). See [`docs/architecture.md`](docs/architecture.md) §5 / §14.

**Full multimodal I/O + uncensored (Slice 27).** `src/media/` adds vision/audio/video **input** and text→image/speech/video **generation**, all **media-by-reference**: a run-scoped `MediaStore` mints a short handle (`img_1`/`aud_1`/`vid_1`) for every piece of media, and only a `[img:h]`/`[audio:h]`/`[video:h]` marker travels through the router and the delegation boundary — the specialist that needs the bytes resolves the handle at the last moment. **Input:** `bun run src/cli/chat.ts "..." --image path.png` (also `--audio`/`--video`, repeatable, plus prompt-embedded path auto-detection and macOS `--paste`); audio is transcribed via `mlx-whisper` and spliced into the prompt as text, video is frame-sampled via `ffmpeg` into a handle-group, and images/frames resolve to real AI-SDK v6 attachments for the new **`vision`** specialist (`qwen2.5vl:7b`). **Generation:** a new **`media_creator`** specialist calls `generate_image`/`generate_speech`/`generate_video` tools backed by mflux (image), Kokoro/mlx-audio (speech), and LTX/mlx-video (video) — each a subprocess behind a shared `MediaGenerator` job adapter (`ExecMode.OneShot|Server`, cancel-safe, wall-clock-timeout-guarded). **Uncensored is a default-ON, cross-cutting axis** (`AGENT_UNCENSORED=0` to opt out): a model-eligibility predicate plus a Diffusers/ComfyUI-lane safety-checker disable (a no-op on the filter-free default engines), with `content_policy` telemetry on every run and a fail-safe voice-clone consent gate. **Live-verified on real hardware:** vision, STT, video frame-sampling, image generation (real `mflux` PNG), speech generation (real Kokoro wav), and uncensored (a real abliterated model, pulled and run). **Video *generation*:** the `mlx-video` ↔ `transformers` dependency conflict is **resolved** via an isolated video venv (`bun run setup:media`, `transformers==5.5.0` pinned), and the strategy's **CLI arg-correctness is live-verified** against the real `mlx_video.ltx_2.generate` CLI (caught + fixed `-n`→`--num-frames` and a required `--pipeline`, `AGENT_VIDEO_PIPELINE`-overridable). A full end-to-end render is **disk-bound** on the dev Mac (LTX-2 is a 19B model, ~100 GB full repo, vs. ~90 GB free) — the framework's hardware-adaptive "scales on a higher-disk box" case, not a code gap; the code (strategy, tool, server-lane degrade) is complete, unit-tested, reviewed, and now CLI-verified. See [`docs/architecture.md`](docs/architecture.md) §22.

---

## Quick start

**Prerequisites:** [Bun](https://bun.com) ≥ 1.3, [Ollama](https://ollama.com)
(running locally), an Apple Silicon Mac, and [`uvx`](https://docs.astral.sh/uv/)
(for the keyless web-fetch agent — `uvx mcp-server-fetch`). The unit/mock test
suite needs none of these; only the CLI and opt-in live tests do.

```sh
bun install                 # install dependencies (pinned, see below)
bun run typecheck           # type-check
bun test                    # run the test suite (no model needed — uses a mock)
bun run lint                # lint + format check (Biome)
```

**Start Ollama the project way (do this on every machine).** Quit the Ollama
menu-bar app first, then:

```sh
bun run serve               # runs `ollama serve` with OLLAMA_MODELS=./model-images
```

This is the **uniform process across all machines** — laptop, Mac Mini, etc.
Models always live under [`model-images/`](model-images/README.md) (git-ignored,
so each machine keeps its own copy), and the framework pulls anything missing on
first use. Then, in another terminal:

```sh
# Real end-to-end (downloads the specialist model, e.g. qwen3.5:9b, on first run):
echo "The quick brown fox jumps over the lazy dog." > /tmp/sample.txt
bun run src/cli/chat.ts "What animal is in /tmp/sample.txt?"
```

Run a deterministic workflow (fixed steps, not LLM-routed) with `bun run flow`,
run a role-based crew with `bun run crew`, and inspect any run's OTel trace with
`bun run runs`:

```sh
bun run flow fetch-then-summarize "https://example.com"   # run a registered workflow
bun run crew research-crew "local vector databases"       # run a registered crew
bun run runs                                              # list recent runs
bun run runs <run-id>                                     # render its trace as a timeline
```

### Multimodal setup

Working STT, image-gen, and TTS (plus isolated video-gen) with **one command**:

```sh
bun run setup:media
```

This installs `ffmpeg` (via Homebrew on macOS) and two Python venvs the
media engines run in — a "media" venv (mlx-whisper, mflux, mlx-audio +
misaki[en], all auto-installed) and a separate **isolated** "video" venv
(mlx-video, with `transformers` pinned to `5.5.0` **after** the mlx-video
install so the pin wins over its own resolver — this is what resolves the
`mlx-video` ↔ `transformers>=5` conflict that used to block video-gen; see
`docs/architecture.md` §22 for why the two venvs can't share one
`transformers` version). It's idempotent, so it's safe to re-run any time.
See `scripts/setup-media.ts` and [`docs/architecture.md`](docs/architecture.md)
§22 for the mechanics.

**Image generation works immediately, no HuggingFace account needed** — the
default model is an ungated mirror. **Video generation** is CLI-verified
against the real `mlx-video` engine in that isolated venv, but a full render
is disk-hungry (LTX-2 is a 19B model, ~100 GB full repo) — it needs enough
free disk, which the shared dev Mac doesn't have; a machine with more disk
renders it as-is. The only manual, user-only step is for
**gated model variants**: run `huggingface-cli login` **in your own
terminal** (never paste an HF token into an AI chat) and accept that model's
license on huggingface.co.

---

## Architecture at a glance

The framework sits on **Vercel AI SDK 6** (provider abstraction + tool-calling
loop) and adds only the thin layers it needs. Tools are exposed over **MCP** so
they're reusable across other agent tools (Claude Code, Cursor, …).

```
                 ┌─────────────────────────────┐
   you  ───────► │  cli/chat.ts (entrypoint)   │
                 └──────────────┬──────────────┘
                                │
       ┌────────────────────────┼─────────────────────────┐
       ▼                        ▼                          ▼
┌──────────────┐      ┌───────────────────┐       ┌────────────────┐
│  resource/   │      │  core/agent.ts    │       │   run/         │
│  (budget,    │      │  runAgent loop    │       │  run-store +   │
│  warm/unload)│      │  (AI SDK 6 +      │       │  journal       │
└──────┬───────┘      │  stopWhen guard)  │       └────────────────┘
       │              └─────────┬─────────┘
       ▼                        │ tools (ToolSet)
┌──────────────┐                ▼
│ providers/   │      ┌───────────────────┐      ┌──────────────────┐
│ ollama.ts ──►│      │  mcp/client.ts ──►│─────►│ mcp/server.ts    │
│ (LanguageMod)│      │  (createMCPClient)│ stdio│  read_file tool  │
└──────────────┘      └───────────────────┘      └──────────────────┘
```

**Full details, data-flow diagrams, and design decisions:**
[`docs/architecture.md`](docs/architecture.md).

### Project structure

| Path | Responsibility |
|---|---|
| `src/core/` | `agent.ts` (the loop), `agent-def.ts`, `delegate.ts`, `orchestrator.ts`, `capability-gap.ts`, `resource-capture.ts` (the `{kind:'resource'}` seam), `types.ts` (download `ProviderKind` + inference `RuntimeKind`), `kind-map.ts` (`downloadKindFor`/`runtimeKindFor`), `errors.ts` |
| `src/providers/` | `ollama.ts` — builds an AI SDK model from a declaration |
| `src/resource/` | `hardware.ts` (live free-RAM via `vm_stat` + Metal-cap ceiling), `footprint.ts` (weights + KV split), `kv-cache.ts` (per-model arch-derived KV sizing + quant-risk), `model-manager.ts` (load/evict/pin + dynamic `num_ctx`), `model-store.ts` (installed-model cache), `selector.ts` (capability filter + largest-that-fits + `resolveModel` fallback loop), `ollama-control.ts` (pull/warm/unload/`getModelMaxContext`/`getModelKvArch`) |
| `src/runtime/` | `runtime.ts` (runtime port), `ollama.ts` (its own control impl) + `mlx-server.ts`/`strategies/{llamacpp,lmstudio,mlx}.ts` (4 adapters, the latter 3 sharing `managed-openai-compatible.ts`'s `createManagedRuntime(strategy)` control surface, Slice 26), `process-supervisor.ts` (spawn/health-poll/kill-on-timeout for spawned strategies), `registry.ts` (runtime registry) — build a model from a declaration per provider |
| `src/discovery/` | `discover.ts` + `build-registry.ts` (offline registry merge), `catalog-source.ts` + `huggingface-gguf.ts` + `huggingface-mlx.ts` + `hf-client.ts` (HF catalogs), `host.ts` (machine detect), `catalog-cache.ts`, `quant.ts`, `sources.ts` |
| `src/run/` | `run-store.ts` (run dirs + artifacts), `journal.ts` (resumable JSONL log) |
| `src/tools/` | `read-file.ts` — the `read_file` tool |
| `src/mcp/` | `types.ts`/`config.ts` (`mcp.json` registry, per-entry degrade), `consent.ts` (spec/tools-hash pinning, `.mcp-approvals.json`), `mount.ts` (`mountAll`, per-agent slices), `pack.ts` (12-entry starter pack), `client.ts` (`mountMcpServer` primitive; completes the first-time OAuth handshake, Slice 26), `oauth-provider.ts` (real `OAuthClientProvider`: DCR/PKCE/CSRF-state/AS-metadata persistence, Slice 26), `token-store.ts` (0600 atomic on-disk token/client store, Slice 26), `loopback.ts` (browser-redirect capture, Slice 26), `server.ts`/`sqlite-server.ts` (in-repo servers) |
| `src/cli/` | `chat.ts` (entrypoint), `run-chat.ts` (testable orchestration), `flow.ts` (`bun run flow`), `crew.ts` (`bun run crew`), `with-mcp-run.ts` (per-run scope + telemetry + mount helper, Slice 16), `with-run.ts` (`withRunTelemetry` — the mount-free per-run telemetry scope for the builder + archive CLIs, so their `build.verify`/`build.archive` spans land in `runs/<id>/spans.jsonl`, Slice 20), `select-hook.ts` (selector-driven `onBeforeDelegate`), `selection-notice.ts` (per-delegation notice), `mcp.ts` (`bun run mcp list\|status\|add`), `agent-builder.ts` (`bun run agent-builder "<need>" [--yes] [--force]`, Slice 17; `--force` commits a failed gate at `unverified` with a WARNING), `crew-builder.ts` + `offer-crew.ts` (`bun run crew-builder "<need>" [--yes] [--force]`, Slice 19), `archive.ts` (`bun run archive [--prune]`, Slice 20) |
| `src/agent-builder/` | Specialist agent generation (Slice 17): `types.ts`, `generate.ts` (prompt-injection-guarded draft), `suggest-tools.ts` (palette-only server pick), `validate.ts` (structural gate), `write.ts` (atomic file + registry + `mcp.json` scoping), `builder.ts` (`buildAgent`/`buildTool`: generate→suggest→validate→retry→consent→write), `deps.ts` (live tools-capable largest-that-fits model); Slice 18 adds the consent-gated inert tool-code path (`generate-tool.ts`/`validate-tool.ts`/`write-tool.ts` → `<name>.proposal.ts`) |
| `src/crew-builder/` | Crew/workflow generation from a multi-step need (Slice 19, Phase D): `ir.ts` (`CrewIR`/`WorkflowIR` + Zod), `safe-helpers.ts` (the closure vocabulary), `classify.ts`/`analyze.ts`/`plan-nodes.ts`/`plan-edges.ts` (staged generation), `validate.ts` (two-tier structural+semantic gate), `resolve-members.ts` (auto-build missing agents via the agent-builder), `transpile.ts` (deterministic IR→TS), `write.ts` (atomic multi-write; split into stage/register since Slice 20), `builder.ts` (`buildCrewOrWorkflow` orchestrator), `deps.ts`; CLI `bun run crew-builder "<need>" [--yes]` (`src/cli/crew-builder.ts`) + a TTY-gated `chat.ts` multi-step gap-offer (`src/cli/offer-crew.ts`) |
| `src/verified-build/` | Behavioral verification of generated artifacts (Slice 20): `gate.ts` (`verifyAndCommit`, the stage→verify→commit spine), `signature.ts`/`reuse.ts`/`manifest.ts` (capability signature + cosine reuse bands + `.generated.json` sidecar), `dry-run.ts`/`repair.ts` (bounded real execution + self-repair), `judge.ts`/`golden.ts`/`eval.ts` (cross-family judge selection, 3–7 golden cases, unanimous rubric eval), `usage.ts` (usage from `spans.jsonl`), `archive.ts` (reversible idle-near-duplicate archiving), `types.ts`/`config.ts` (`VerifiedLevel`/`ReuseKind`/… + env-fallback-only thresholds) |
| `models/` | model **declarations** (data, not weights) — `qwen-fast.ts`, `qwen-router.ts`, `registry.ts` (bootstrap capability ladder) |
| `agents/` | agent definitions — **all agents live here** ([readme](agents/README.md)); `index.ts` is the `AGENTS` registry (`agentNames()`) generated agents register into (Slice 17) |
| `model-images/` | local model blob files (git-ignored, [readme](model-images/README.md)) |
| `docs/` | architecture + the design specs/plans under `docs/superpowers/` |

---

## Why local models, no API keys

The whole point is a self-owned inference box (the Mac Mini). Depending on paid
APIs would defeat that. A single cloud **escape hatch** — Codex via the official
SDK on a personal plan — is planned as an *opt-in* "heavy lifting" backup, never
the default. (Gemini CLI and Claude Code are intentionally excluded.)

## Why Ollama (and where llama.cpp fits)

Short answer: **we are using llama.cpp — through Ollama.** Ollama is a wrapper
around the llama.cpp inference engine (and Apple's MLX on 32 GB+ Macs). Choosing
Ollama isn't choosing *against* llama.cpp; it's choosing not to hand-roll the
layers an agent system needs on top of it:

- **Model management** — `pull` / `list` / `ps`, automatic quantization
  selection. Raw llama.cpp means managing GGUF files and load flags ourselves.
- **An HTTP control API** — warm / `keep_alive` / unload / `/api/ps`. Our
  **autonomous resource manager** needs exactly this to load/unload models and
  read what's resident. With bare llama.cpp we'd build that layer by hand.
- **First-class tool-calling** — reliable function-calling for agents, plus a
  clean AI SDK provider (`ollama-ai-provider-v2`).
- **MLX for free** — on 32 GB+ Apple Silicon, Ollama 0.19+ runs on an MLX
  backend, faster than vanilla llama.cpp Metal.

Critically, the model layer is **runtime-agnostic** (ports/adapters via AI SDK's
`LanguageModel`). Ollama is just the default Tier-1 adapter — a managed
**llama.cpp-server**, **LM Studio**, and **MLX-server** adapter all now sit
behind the same interface too (Slice 26, §5), for when lower-level control
(custom sampling, a specific runtime already installed) is wanted; no agent
code changes either way. Heavier MLX variants (persistent KV-cache via omlx,
higher concurrency via vMLX) can slot in the same way later. See
[`docs/architecture.md`](docs/architecture.md#why-ollama).

---

## Roadmap

| Slice | Scope | Status |
|---|---|---|
| **1** | One agent (file Q&A) · resource warm-up/unload · MCP `read_file` · run store | ✅ Done |
| **2** | Super-agent (agents-as-tools) delegating to sub-agents · `report_capability_gap` (route-or-gap) · opt-in live test | ✅ Done |
| **3** | **Integrations:** `mountMcpServer()` (mount any MCP server) · web-fetch agent via keyless `uvx mcp-server-fetch` · multi-specialist routing · opt-in live tests | ✅ Done |
| **4** | **Model Manager:** multi-model, hardware-aware — small pinned router (`qwen3.5:4b`) + on-demand specialists (`qwen3.5:9b`) · live free-RAM budget (`min(75% Metal cap, 80% available)` via `vm_stat`, per-delegation) · best-effort pin (pinned evicted only as last resort) · dynamic `num_ctx` sized from headroom, clamped by live model max, floored at 4096 | ✅ Done |
| **5** | **Dynamic model selection** — agents declare a capability requirement (`requires`/`prefer`) instead of a fixed model; registry + selector pick the largest model that fits the live budget; Model Manager loads it; genuine no-fit surfaces as `{kind:'resource'}` | ✅ Done |
| **6** | **Model discovery** — `runDiscovery` fetches tool-capable GGUF/MLX models from Hugging Face (trusted publishers, sized to live RAM), writes `model-images/catalog.json`, pre-pulls the top fit; offline merge of bootstrap + local + catalog at chat time; Ollama + MLX-server runtimes; four-axis taxonomy (capability/modality, runtime, source, content-policy) | ✅ Done |
| **7** | **KV-cache quantization** — global `AGENT_KV_CACHE_TYPE` (default q8_0); `OLLAMA_FLASH_ATTENTION=1` required; per-model arch-derived sizing from `/api/show`; generalized arch-risk advisory (small head_dim / MoE) | ✅ Done |
| **8** | **Run-viewer / OTel telemetry** (Phase A) — every run is an OpenTelemetry trace (`runs/<id>/spans.jsonl`); `bun run runs` (list / `<id>` timeline / `--follow`); swappable OTLP backend via `AGENT_OTLP_ENDPOINT` | ✅ Done |
| **9** | **Composition guardrails** (Phase B prerequisite) — `AsyncLocalStorage` delegation context; depth limit (default 5, `AGENT_MAX_DELEGATION_DEPTH`); live return-size cap (¼ × caller `num_ctx`, `AGENT_RETURN_CTX_FRACTION`); soft-error surfacing + `agent.guardrail.violation` span event | ✅ Done |
| **10** | **Workflow / DAG engine** (Phase B) — `defineWorkflow({id, steps})`, code-first typed DAG; step kinds `agent`/`tool`/`branch`/`map`; Zod-validated step I/O; fail-fast + per-step `onError`; `bun run flow <name>` + `workflows/` registry + `runWorkflow()`; reuses Slice 9 guardrails | ✅ Done |
| **11** | **Crews & roles** (Phase B) — `defineCrew({id, members, tasks, process})`; members with role/goal/backstory (live model selection) + tasks with `dependsOn`; `sequential` (compiles to a Slice-10 workflow) and `hierarchical` (orchestrator + auto manager) processes; `bun run crew <name>` + `crews/` registry; reuses Slice 9 guardrails; live model selection also wired into the `flow` CLI via shared `src/cli/select-runtime.ts` | ✅ Done |
| **12** | **Memory / RAG** (Phase B) — `src/memory/`: two-tier store (LanceDB table-per-space + `bun:sqlite` space registry/document manifest); weights-only embedder (`qwen3-embedding:0.6b`) loaded via the Model Manager; dense-vector retrieval → optional cross-encoder rerank (default-on, graceful degradation) → live budget-fit pack; citation-tagged + abstaining `recall` tool; `bun run memory ingest\|recall\|stats\|reindex`; optional crew/workflow `memory` dep (bound `recall` tool + auto-persist) | ✅ Done |
| **13** | **Grounded verification** (Phase B) — `src/verification/`: claim decomposition + cited-evidence lookup (`getByIds`) → per-claim MiniCheck faithfulness judge (`bespoke-minicheck`, consent-pull + general-model fallback) → bounded Corrective RAG (rewrite + re-answer; re-recall when `recall` wired; CLI path re-answers without retrieval—documented follow-up, once) → abstain on fail (`{kind:'unverified'}`); opt-in `--verify` on `bun run crew`/`flow` splices a verify→branch→corrective→abstain sub-graph (`StepKind.Verify`) after the terminal answering step; writes `runs/<id>/unverified.txt` + non-zero exit on abstention; in-repo golden-set eval gate (no external framework) | ✅ Done |
| **14** | **First-boot provisioning + downloader** (Phase A/ops) — `src/provisioning/`: runtime-agnostic `DownloadProvider` abstraction (Ollama live-verified at Slice 14; MLX live-verified Slice 18; LM Studio + llama.cpp GGUF live-verified Slice 26) + unified progress protocol; two-phase catalog discovery (dynamic per-runtime query + committed-snapshot fallback); hardware-fit ranking + per-model consent; disk preflight + stall/retry supervisor guards; `bun run provision` + a non-invasive `chat.ts` auto-detect hook | ✅ Done |
| **15** | **`mcp.json` mount registry + starter pack** (Phase C) — `src/mcp/`: declarative registry (`config.ts`, per-server `agents` scoping) replaces Slice 3's hardcoded mounts; consent-gated mounting with spec-hash/tools-hash pinning against tool-definition drift (`consent.ts`, `mount.ts`); 12-entry curated starter pack (`pack.ts`, `bun run mcp list\|status\|add`); registry wired into all three CLIs (`chat`/`flow`/`crew`); live scoping eval (`tests/mcp/eval-scoping.test.ts`) | ✅ Done |
| **16** | **MCP telemetry-ordering fix + consent robustness** (Phase C follow-on) — `src/cli/with-mcp-run.ts` owns `createRun` → `initRunTelemetry` → `withMcpMountSpan(mountAll(...))` for `chat`/`flow`/`crew` so `mcp.mount` now lands in `runs/<id>/spans.jsonl` (previously silently dropped); mount span gains `mcp.server.count` + a corrected (summed) `mcp.tool.count`; `runFlow`/`runCrewCli`/`runChat` now take `run: RunHandle` from the caller; consent interactivity now requires stdin **and** stderr TTY (`interactiveTTY()`), and `stdinInput()` resolves on stream `end` (no more hang on `< /dev/null`) | ✅ Done |
| **17** | **Agent-builder** (Phase D) — generate a specialist on a capability gap: `src/agent-builder/` drafts a proposal (prompt-injection-guarded), suggests a minimal palette-only server subset from the Slice 15 pack, validates it structurally, requires explicit consent, then atomically writes the agent file + a new `agents/index.ts` registry entry + scoped `mcp.json`; triggers via `bun run agent-builder "<need>"` and a TTY-gated `chat.ts` gap-offer (the `{kind:'gap'}` outcome itself is unchanged); `agent.build` telemetry span; safety model = review-before-activate, palette-only, no same-run activation | ✅ Done |
| **18** | **Debt wrap-up + MLX completion** — split the overloaded enum into download `ProviderKind` + inference `RuntimeKind` (+ `kind-map.ts`); `hf-fetch` now persists weights to disk (atomic `.part`→rename, HF-LFS-oid verify, single-file GGUF + MLX snapshot, traversal-guarded, retry/stall parity); MLX runtime raised to Ollama's bar (`createMlxServerRuntime`, opt-in + degrade-to-Ollama via `fallbackModel`); provisioning polish (bounded-parallel downloads + `MultiProgressBar`, truthful telemetry, Metal reader, `refresh-snapshot.ts`); MCP/agent-builder debt (engine-enforced read-only sqlite via `PRAGMA query_only`, MCP OAuth `authProvider`, `mcp.transport`, atomic `addPackEntry`, agent-builder retry + inert-`.proposal.ts` tool-code path). LM Studio download wired (contract-tested); MLX **live-verified both ways** | ✅ Done |
| **19** | **Crew/workflow builder** (Phase D) — compose, not just generate: `src/crew-builder/` turns a multi-step need into a **crew** or **workflow** via a staged, validated IR-then-transpile pipeline (`classify`→`analyze` think-first→`plan-nodes`→`plan-edges`→two-tier `validate`→consent→`resolve-members` auto-build via the agent-builder→deterministic `transpile`→atomic `write`); a small safe-helper vocabulary (`fromInput`/`fromStep`/`fromTemplate`/`whenEquals`/`whenContains`/`whenTruthy`/`mapOver`) is the only closures a model can pick from; shared `assertAcyclic` (`workflow/define.ts`) gates both shapes' graphs; `CrewMember.agentRef` lets a crew member reuse a registered (or freshly-built) agent; triggers via `bun run crew-builder "<need>"` and a TTY-gated `chat.ts` multi-step gap-offer; `crew.build` telemetry span. **Live-verified end to end on Ollama** — a generated crew executed to a correct result, surfacing + fixing 4 live-only defects | ✅ Done |
| **20** | **Verified "works out of the box"** (Phase D — closes the phase) — `src/verified-build/`: builder writes become **stage → verify → commit** via a shared cheapest-first gate — pre-generation **reuse check** (capability-signature embedding vs a per-registry `.generated.json` manifest; ≥0.85 confirm-gated reuse · 0.75–0.85 offer, ask reuse-or-build · <0.75 generate; `--yes` auto-reuses Reuse, declines Offer) → stage (never the index) → structural → **execution dry-run** (`withWallClock`-raced; the agent path additionally aborts in flight via a new `runAgent` `abortSignal` seam — crew/workflow are wall-clock-raced only; ≤2 self-repair attempts feeding the runtime error back into a regeneration) → **golden-eval** (3–7 auto-generated binary cases, largest-installed judge preferring cross-family, unanimous over 3 runs; no judge ≥ ~24B ⇒ skip + commit `verified: runs` — degrade, never block) → commit (index + `<name>.golden.json` + manifest) at the earned `VerifiedLevel`; failed gate registers nothing and the staged file is discarded (`--force`/`verify.force` ⇒ `unverified` + WARNING). Plus usage aggregation from `spans.jsonl` + reversible archive (`bun run archive [--prune]`, live-reference-protected cross-registry) + a chat reuse hint; `build.verify`/`build.archive` telemetry. **Live-verified on Ollama** — a real build committed at `verified: runs` (judge-degrade path) and a re-run of the same need hit reuse at 89% | ✅ Done |
| **21** | **Graceful degradation + retries** (Phase A — fills the last reliability gap; the routing-accuracy eval harness remains the one open Phase-A item) — `src/reliability/`: a three-lane error taxonomy (`classify.ts` — `Lane.Transient/RouteWorthy/Terminal`, pure, unknown→Terminal); retry with full-jitter backoff + attempt-cap + `Retry-After` respect, Transient-only (`retry.ts`); run wall-clock + idle-stall timeouts (`timeout.ts`); a hand-rolled circuit breaker with a shared per-dependency registry (`breaker.ts`); a failure-domain-aware model-degradation chain (`degrade.ts`); a user-facing `DegradationLedger` (`ledger.ts`) persisted to `run.dir/degradation.jsonl` and printed as a run summary. Wired into delegation (drop/degrade + record), the workflow engine + crews (per-step retry/timeout, breaker-wrapped Tool/MCP steps), MCP tool calls (`wrapToolsWithBreaker`), and the model selector (`degradeChain`). Per **D5**, the LLM turn itself is never double-retried (AI SDK v6 already retries transport errors) — only cross-boundary ops the framework owns get `withRetry`. Migrated the pre-existing provisioning stall/retry guards and the verified-build wall-clock primitive onto the same layer. **Live-verified on real Ollama** (4 scenarios, `tests/integration/reliability-live.test.ts`, `RELIABILITY_LIVE=1`) — MLX-unreachable degrades to a real Ollama fallback that generates, a failing-then-succeeding Tool step retries to completion, a delegated agent whose model call fails returns a structured error without crashing, and a real `withMcpRun` persists `degradation.jsonl` + a `reliability.degrade` span event. See [`docs/architecture.md`](docs/architecture.md) §21 | ✅ Done |
| **26** | **Alternate runtimes + remote-auth completion** (debt — gated on installing those runtimes/having creds, landed out of numeric sequence once both existed) — **Phase A:** `src/runtime/managed-openai-compatible.ts`'s `createManagedRuntime(strategy)` is the one control-surface implementation shared by **llama.cpp** (`strategies/llamacpp.ts`, `contextCapability:'relaunch'` — kills+respawns `llama-server -c <numCtx>`), **LM Studio** (`strategies/lmstudio.ts`, `'reload'` — `@lmstudio/sdk`'s `client.llm.load(model,{config:{contextLength}})` against the always-on daemon), and **MLX** (`strategies/mlx.ts`, `'fixed'` — `mlx_lm.server` has no context flag, so a requested context is honestly never applied); `process-supervisor.ts` owns spawn/health-poll/kill-on-timeout (fresh free port per relaunch, `breakerFor('runtime:'+kind)`); `mlx-server.ts` rewritten onto this base while preserving its external-baseUrl no-spawn compat path; `select-hook.ts` now calls `rt.control.warm(model, numCtx)` for every non-Ollama runtime; new `RUNTIME_*` telemetry (`telemetry/spans.ts`'s `withRuntimeSpan`); the LM Studio download adapter's job-status poll URL fixed (wrong since Slice 18). **Phase B:** `src/mcp/oauth-provider.ts`'s `createOAuthProvider` is a real `@ai-sdk/mcp` `OAuthClientProvider` (DCR/CIMD, PKCE + CSRF `state`, browser-loopback via `loopback.ts`, authorization-server metadata persistence) backed by `token-store.ts`'s atomic **0600** `~/.config/ai/mcp-tokens.json`; `with-mcp-run.ts` now actually builds an `authProvider` per OAuth config entry (previously never populated — OAuth always silently degraded); `mcp/client.ts`'s `mountMcpServer` completes the first-time handshake on `UnauthorizedError`; new `mcp.auth.*` telemetry. **Live-verified on real hardware:** all 3 managed runtimes end to end (llama.cpp `n_ctx=8192`, LM Studio `ctx=4096`, MLX fixed), both download adapters, a GitHub-PAT remote server, and a full Linear OAuth handshake (DCR→browser→exchange→47 tools; token-reuse with no browser on a second run) — this pass caught 3 real defects (poll URL, incomplete handshake, missing AS-metadata persistence), all fixed in-slice. New dep `@lmstudio/sdk`. See [`docs/architecture.md`](docs/architecture.md) §5 / §14 | ✅ Done |
| **27** | **Full multimodal I/O + uncensored** (Phase F, pulled in on demand ahead of the daemon) — new `src/media/` subsystem, media-by-reference throughout (a run-scoped `MediaStore` mints `img_N`/`aud_N`/`vid_N` handles; `[img:h]`/`[audio:h]`/`[video:h]` markers travel through the router/delegation boundary, never raw bytes). **Input:** `ingest.ts` (`--image`/`--audio`/`--video`/`--paste` + prompt-embedded path auto-detection, per-item graceful degrade), `audio/transcribe.ts` (`mlx-whisper` STT), `video/frames.ts` (`ffmpeg` frame-sampling → a frame-group handle), `resolve.ts` (handles → base64 AI-SDK v6 `FilePart`s); new **`vision`** specialist (`qwen2.5vl:7b`, `Capability.Vision`, selector-routed like any other specialist). **Generation:** `generate/adapter.ts`'s `MediaGenerator` (`ExecMode.OneShot|Server`, cancel-race-safe, wall-clock-timeout-guarded, `runGenJob` same-kind degrade dispatcher) backs mflux (image, via an ungated FLUX-schnell mirror), Kokoro/mlx-audio (speech), and LTX/mlx-video (video) strategies + a shape-only ComfyUI/Wan server lane; `generate_image`/`generate_speech`/`generate_video` tools on a new **`media_creator`** specialist. New `Capability.ImageGen/SpeechGen/VideoGen` type the taxonomy (not yet selector-consumed). **Uncensored** ships **default-ON**, two orthogonal mechanisms: model-eligibility (`policy.ts`, `select-hook.ts`'s `allowUncensored`) + Diffusers/ComfyUI safety-checker disable (`generate/safety.ts`, no-op on the filter-free default engines), plus `content_policy` run telemetry and a fail-safe voice-clone consent gate (`consent.ts`, orthogonal, cloning models only) and a `LEGAL_NOTE` string constant. New `INPUT_MODALITY`/`CONTENT_POLICY` attrs + `media.transcribe`/`media.frames`/`media.generate` spans. **Live-verified on real hardware:** vision, STT, video frame-sampling, image generation (real `mflux` PNG), speech generation (real Kokoro wav — `misaki[en]` auto-installed by `bun run setup:media`), and uncensored (a real pulled-and-run abliterated model). **Video *generation*:** the `mlx-video`↔`transformers` dependency conflict is **resolved** via an isolated video venv (`bun run setup:media`, `transformers==5.5.0` pinned) and the strategy's **CLI arg-correctness is live-verified** against the real CLI (caught + fixed `-n`→`--num-frames` + a required `--pipeline`); a full render is **disk-bound** on the dev Mac (LTX-2 is a 19B model, ~100 GB full repo vs. ~90 GB free) — the framework's hardware-adaptive "scales on a bigger box" case, not a code gap; the generation code itself is complete, unit-tested, reviewed, and now CLI-verified. ComfyUI/Wan server lane is shape-only (ComfyUI not installed). See [`docs/architecture.md`](docs/architecture.md) §22 | ✅ Done |
| **Next (product line)** | Toward a local **n8n × CrewAI**: **E** automate (always-on daemon + secure remote access, **Slice 24**; scheduled/triggered agents, 25) → **F** remaining breadth on-demand (voice in/out · streaming CLI · TUI/local web UI) — Codex heavy-lifting backup (Slice 22) deferred to the very end (Slice 38); dependency major-upgrade (23) held on ecosystem | Planned |

**Full long-range roadmap** — the n8n × CrewAI vision, the six product phases,
the continuous hardware-aware engine line, and the recommended sequence:
[`docs/ROADMAP.md`](docs/ROADMAP.md). Design specs and implementation plans live
in [`docs/superpowers/`](docs/superpowers/).

---

## Development

```sh
bun run test -- -t "test name"      # single test by name
bun run test:file -- ./tests/...    # a specific test file
bun run lint -- --write             # auto-fix lint/format
```

- **Stack:** TypeScript + Bun + Vercel AI SDK 6. Pinned: `ai@^6` (not v7 — it
  renames APIs), `ollama-ai-provider-v2@^3`, `@ai-sdk/mcp@^1`,
  `@modelcontextprotocol/sdk@^1`, `zod@^4`.
- **Style:** small single-responsibility files, plain self-explanatory code,
  typed errors, string enums. Tests verify real behavior (the agent loop is
  tested against AI SDK's mock model; the MCP path is a real subprocess
  round-trip).
- **First clone:** run `bun run setup` once to activate the git hooks
  (`.githooks/`). `bun run check` runs the full pre-PR gate
  (docs-check · typecheck · lint · tests).

---

## Documentation

Start at the **[documentation map](docs/README.md)** — the index of every
maintained doc. The key references:

- **[`docs/architecture.md`](docs/architecture.md)** — the living technical map: module/dependency graph, runtime data-flow, every subsystem and mechanism.
- **[`docs/ROADMAP.md`](docs/ROADMAP.md)** — the long-range plan (local-first n8n × CrewAI, phases A–F).
- Module docs: [`agents/README.md`](agents/README.md), [`model-images/README.md`](model-images/README.md). Per-slice design records: [`docs/superpowers/`](docs/superpowers/).

**The hard line:** documentation stays current with the code — a stale doc is a
defect, not debt. Every slice updates `architecture.md` (and this map if a doc
is added/renamed); the slice's final review audits the doc against the diff for
accuracy. Enforced by `bun run docs:check` (pre-commit) and a pre-push currency
gate. See the [documentation map](docs/README.md) for details.
