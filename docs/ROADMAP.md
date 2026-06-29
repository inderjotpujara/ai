# Roadmap

The long-range plan for this local-first, self-owned multi-agent platform. Each
item below becomes its own **brainstorm → spec → plan → subagent-driven build**
cycle (the same flow used for Slices 1–5). Order is a recommendation driven by
**dependencies + leverage**, not a contract — reprioritize freely.

> **North stars:** local-first & self-owned (no API keys) · one orchestrator
> routing to a growing fleet of specialists · capabilities are pluggable (mount
> an MCP server) · self-extending (build new agents on demand) · autonomous &
> **hardware/context-aware** on Apple Silicon.

## Shipped

| Slice | Capability | Status |
|---|---|---|
| **1** | Local file-Q&A agent · model warm-up/unload · MCP `read_file` · run store | ✅ shipped + live-verified |
| **2** | Orchestrator (agents-as-tools) — route to a specialist or report a capability gap | ✅ shipped + live-verified |
| **3** | `mountMcpServer` (mount any MCP server) · web-fetch agent (`uvx mcp-server-fetch`) | ✅ shipped + live-verified |
| **4** | **Model Manager** — multi-model, hardware-aware: live free-RAM budget (`min(75% Metal cap, 80% available)` via `vm_stat`, per-delegation); load/evict/pin within budget; best-effort pin (pinned evicted only as last resort); dynamic `num_ctx` sized from headroom, clamped by live model max (`POST /api/show`), floored at 4096; orchestrator on pinned `qwen3.5:4b`, specialists on `qwen3.5:9b` on demand | ✅ shipped + live-verified |
| **5** | **Dynamic model selection** — agents declare a capability requirement (`requires`/`prefer`) instead of a fixed model; a bootstrap registry + selector pick the largest model that fits the live budget; Model Manager loads it; genuine no-fit surfaces as `{kind:'resource'}` and a non-zero exit instead of a hallucinated answer | ✅ shipped + live-verified |
| **6** | **Model discovery** — `runDiscovery` fetches tool-capable GGUF/MLX models from Hugging Face (trusted publishers, sized to live RAM), writes `model-images/catalog.json`, pre-pulls the top fit; offline `buildRegistry` merges bootstrap + local + catalog at chat time; Ollama + MLX-server runtime ports; four-axis taxonomy (capability/modality, runtime, source, content-policy); `hf-gguf` + `hf-mlx` catalog sources; host detector; live discover + MLX verify tests. See spec §11 for committed follow-ons. | ✅ shipped + live-verified |

## Near-term — resource-manager & model quality line

| Slice | Capability | Depends on | Notes |
|---|---|---|---|
| **7** | **KV-cache quantization** — `q8_0` as the default KV-cache type, `q4_0` opt-in with a high-GQA guard (safe only when GQA count is high enough to absorb the quality drop); global `OLLAMA_KV_CACHE_TYPE` + `OLLAMA_FLASH_ATTENTION` env wiring. (See spec §11.) | Slice 6 | Cuts KV-cache RAM by 4× vs fp16 on q4_0; q8_0 default is lossless in practice |
| **4.5** | **Reclaim** — when memory is genuinely tight: degrade → ask once → kill non-essential apps (keeping a protected set) | Slice 4 | Small escalation of the manager; slot in once memory pressure is real |

### Future Work (from Slice 5 brainstorm)

The following items were identified during Slice 5 design (see spec §8) as valuable but deliberately deferred. They are committed for future slices — none are blocking:

- **Global / lookahead scheduler** — today selection is greedy and per-delegation; a planner-aware scheduler with a task DAG could pre-warm models and schedule concurrent delegations globally rather than locally. Depends on a task planner / DAG component.
- **Parallel fan-out memory arbitration** — when multiple specialists run concurrently, their combined footprints must be co-scheduled within the live budget. Requires an explicit `maxLoaded` cap on the Model Manager (today the only count ceiling is Ollama's `OLLAMA_MAX_LOADED_MODELS` env default) so concurrency is governed by both RAM headroom and a first-class model-count limit.
- **Interactive resource arbitration** ("user takes calls") — when memory is genuinely exhausted and degradation has already bottomed out, surface a user-visible ask before killing non-essential processes. Overlaps with Reclaim (Slice 4.5); design together.
- **Quality-ranked selection** — once Slice 6 populates the registry with richer metadata (benchmark scores, eval results), the selector can rank by quality-within-budget rather than pure size. This is the Slice 6 signal.
- **Richer registry + discovery** — the current registry is a static bootstrap ladder; Slice 6 replaces it with a per-machine runtime fetch from Hugging Face. Includes per-machine capability metadata, pulled-model tracking, and multi-quantization awareness.
- **Router-as-selected** — today the router (`qwen3.5:4b`) is pinned and hardcoded. A future slice could run it through the selector too, so even the routing model is capability-declared and hardware-adaptive.
- **Fuller anti-churn / hysteresis** — the warm-aware tie-break in `selectCandidates` is a lightweight first step. A proper hysteresis policy (e.g. don't evict a resident model unless the challenger is significantly better, or a cooldown window after a recent load) would reduce unnecessary model thrashing under oscillating load.

## Committed follow-ons from Slice 6 (spec §11)

These items were identified during Slice 6 design as the natural continuation of the four-axis taxonomy. The `Capability`, `ProviderKind`, and `ContentPolicy` seams are already typed; each slice activates a seam.

| Slice | Capability | Depends on | Notes |
|---|---|---|---|
| **7** | **KV-cache quantization** — `q8_0` default KV-cache type; `q4_0` opt-in with a high-GQA guard; global `OLLAMA_KV_CACHE_TYPE` + `OLLAMA_FLASH_ATTENTION` env wiring | Slice 6 | Cuts KV-cache RAM 2–4× vs fp16; guard prevents quality regression on low-GQA models |
| **8** | **Vision** — activate the `Capability.Vision` seam; wire a local multimodal model (e.g. Gemma 4, LLaVA) as a specialist; add `hf-gguf` + `hf-mlx` catalog sources filtered by vision capability | Slice 6 | `Capability.Vision` is already declared in `src/core/types.ts` |
| **9** | **Audio** — activate `Capability.Audio`; local Whisper STT + TTS specialist; audio agent exposes a `transcribe`/`speak` tool | Slice 8 | Pairs with voice-in/out UX item |
| **10** | **Video** — activate `Capability.Video`; local video-description specialist (frame sampling + vision model) | Slice 9 | Resumable long jobs (run store already supports it) |
| **11** | **Uncensored mode** — activate `ContentPolicy.Uncensored` seam; add an opt-in uncensored catalog source (trusted publishers, explicit user flag); never the default | Slice 6 | `ContentPolicy` enum is already typed; activation requires explicit opt-in |

Additional committed items (no fixed slice yet):

- **Ollama-native MLX on Mac Mini** — Ollama 0.19+ uses the MLX backend on 32 GB+ Apple Silicon automatically; no code change required; the runtime port means larger MLX-backed Ollama models (e.g. `qwen3.5:14b+`) are picked up by discovery automatically.
- **BFCL offline ranking** — integrate Berkeley Function-Calling Leaderboard offline scores as a quality signal in the catalog; the selector then ranks by quality-within-budget rather than pure downloads/size. Depends on Slice 6's richer catalog metadata.

## Headline next — self-extension

| Slice | Capability | Depends on | Notes |
|---|---|---|---|
| **Agent-builder** ⭐ | On `report_capability_gap`, generate a new agent definition file (+ suggest an MCP server to mount) so the system *grows a capability* on demand. The `report_capability_gap` seam is already in place. | Slices 2, 3, (5/6 help) | **Highest-leverage future feature** — makes "describe a need → the system extends itself" real |

## Orchestration & intelligence

- **Deeper agent graphs** — a "researcher" agent that itself delegates to `web_fetch` + `file_qa` (composability already exists via agents-as-tools), with the **hardware/context-aware guardrails**: delegation **depth limit** + cross-agent **cycle detection** + concise/summarized returns.
- **Parallel fan-out** — when sub-tasks are independent, run specialists **concurrently** within the memory budget the Model Manager enforces.
  - **Explicit `maxLoaded` cap on the Model Manager** — today the manager has **no count limit** on co-resident models; it loads until the live free-RAM headroom is exhausted (now tracked accurately via `vm_stat`), and the only count cap is Ollama's `OLLAMA_MAX_LOADED_MODELS` (default **3** on single-GPU Metal) acting as an implicit backstop. For deterministic parallel fan-out we should add a first-class `maxLoaded` to the manager (bound concurrency in our own scheduler rather than relying on Ollama's env default), so concurrency is governed by both the RAM headroom **and** an explicit model-count ceiling.
- **Response-format tooling** — shape answers into JSON / markdown / tables on request (user-confirmed needed).
- **Memory / RAG** — a local vector store + local embeddings model so agents recall past runs and indexed docs.
- **Image/vision agent** — a local multimodal model (e.g. Gemma 4) describing screenshots/images.

## UX & interface

- **Run-viewer (`/runs`)** ⭐ — replay the JSONL journals already written: timeline of delegations, gaps, artifacts. Makes everything built so far **visible & demoable** (user-noted high value).
- **Streaming CLI** — token-by-token output instead of waiting (already deferred).
- **TUI / local web UI** — chat window + live "which agent is running / which model is loaded" panel + run-history browser.
- **Voice in/out** — local Whisper (STT) + a local TTS model → generalizes the book→audiobook idea into a voice agent.

## Reliability & ops (the hardware-aware north star)

- **Graceful degradation** — if `uvx`/an MCP server/a model is down, **drop that agent and tell the user**, rather than failing the whole CLI.
- **Telemetry / eval** — log per-agent latency, tokens, tool-call success rate; a small **eval harness** scoring routing accuracy (did the orchestrator pick the right specialist?).
- **Resumable long jobs** — the run store + journal already support replay; wire `--resume <run-id>` for multi-hour multimodal jobs.

## Runtimes & scale (alternate model backends)

- **LM Studio / dedicated MLX-server adapters** (deferred since Slice 1) — behind the same AI SDK `LanguageModel` interface: a dedicated MLX server with **persistent KV-cache (omlx)** or **high concurrency (vMLX / LM Studio)** for heavy agent loops, when Ollama's sequential serving + idle-unload isn't enough.
- **Raw `llama.cpp`-server adapter** — for low-level control (custom sampling/flags) if ever needed; Ollama remains the default.

## Bigger leaps — the Mac Mini era

- **MLX backend + bigger models** — the Mac Mini (>32 GB unified memory) engages Ollama's MLX backend (Ollama 0.19+) and can host larger specialists (e.g. `qwen3.5:14b`+, `llama4:scout` long-context) that don't fit the 24 GB laptop budget — the Model Manager already budgets to the host, so this is mostly a declaration change.
- **Always-on daemon** — the orchestrator as a background service with a task **queue**: fire tasks, collect results later.
- **Scheduled / triggered agents** — cron- or event-driven (file added → process it) — the n8n "trigger" concept.
- **Multi-machine** — laptop delegates heavy work to the Mac Mini over the network.
- **A2A interop** — expose this orchestrator as an agent other tools can call, and consume external agents (Agent2Agent protocol).

## Recommended priority next

1. **KV-cache quantization (Slice 7)** — immediate RAM savings with no new capabilities required; q8_0 default is safe, q4_0 opt-in with the GQA guard.
2. **Agent-builder** — the feature that makes the self-extension vision real; the `report_capability_gap` hook is already waiting for it.
3. **Run-viewer UI** — makes the whole system visible and demoable for the cost of reading JSONL we already write.

(Slices 8–11 [Vision/Audio/Video/Uncensored] follow naturally once KV-cache quant lands; each is a seam activation.)

## Deferred technical items (cross-cutting, fold in opportunistically)

- Declarative **`mcp.json` mount registry** (list servers + which agents get them, loaded at startup) — generalizes Slice 3's in-code mounts.
- **Codex** heavy-lifting backup (`@openai/codex-sdk`, personal plan) as an opt-in delegate agent.
- Migrate `biome.json` off the deprecated `recommended` field.
- **Per-slice Minor review findings** are recorded in `.superpowers/sdd/progress.md` (the SDD ledger) as each slice completes — e.g. run-journal O(n²) append, `runAgent.providerOptions` cross-package type, gap `message` hardcoded English, `ensureReady` post-pull comment. ~~hardcoded `kvBytesPerToken`~~ — **resolved**: `footprint.kvBytesPerToken` is now an optional per-model declaration field with default fallback. Sweep remaining items opportunistically; none are blocking.
- **Hardware/context-aware guardrails for deeper composition** (recorded constraint): the agent-graph/parallel-fan-out slices MUST bound delegation depth, add cross-agent cycle detection, reuse warm models (shared-model agents = one resident copy), keep returned answers concise, and schedule concurrency within the Model Manager's budget. Cost compounds ~15× for naive orchestrator-workers, so depth/fan-out are bounded deliberately.
