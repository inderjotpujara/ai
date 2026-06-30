# Roadmap

The long-range plan for this local-first, self-owned agent platform. Each item
below becomes its own **brainstorm → spec → plan → subagent-driven build** cycle
(the same flow used for Slices 1–7). Order is a recommendation driven by
**dependencies + leverage**, not a contract — reprioritize freely.

> ## 🎯 Product North Star — a local-first **n8n × CrewAI**
>
> An **agent-workflow orchestration platform** you fully own: compose role-based
> agents + tools into **workflows** (LLM-driven *or* deterministic), **trigger**
> them (on-demand / schedule / event), **watch** them run, and let the system
> **extend itself** with new agents on demand — all on **local models, zero API
> keys**, governed by a **hardware/context-aware** Model Manager on Apple Silicon.
>
> - **From n8n:** deterministic multi-step **workflows**, a deep **integration
>   library** (we mount MCP servers instead of bespoke nodes), and **triggers**
>   (webhook / schedule / file-event automation).
> - **From CrewAI:** **role-based agent teams** ("crews") with goals + tasks
>   executed by a **process** (sequential or hierarchical), plus shared **memory**.
> - **Our differentiator:** it is **local-first & self-owned** (no cloud, no API
>   keys), **hardware-aware** (the Model Manager budgets every model to live RAM),
>   and **self-extending** (agent-builder grows new capabilities on demand).

---

## Where we are vs. the target (the honest gap)

Seven shipped slices built a deep, sophisticated **engine** (hardware-aware
model/resource management). The **product surface** is still thin: 3 agents
(`super`, `file-qa`, `web-fetch`), 1 native tool (`read_file`) + 1 mounted MCP
server (`mcp-server-fetch`). The next phase pivots from *engine* to *product*.

| n8n / CrewAI concept | Our analog | Status |
|---|---|---|
| AI-agent node (model + prompt + tools + loop) | `Agent` (`src/core/agent.ts`) | ✅ built |
| Hierarchical process / supervisor | orchestrator (agents-as-tools) | ✅ built |
| Self-hosted, your infrastructure | local-first, Ollama, Mac Mini | ✅ core premise |
| Hardware-aware scheduling | Model Manager (live RAM budget, KV quant) | ✅ built (Slices 4–7) |
| Integration library (n8n's 400+ nodes) | mounted MCP servers | 🟡 1 server — needs a **mount registry + pack** |
| **Workflow / DAG (deterministic steps)** | **workflow engine** | ❌ **the defining gap** |
| **Crew (role + goal + task + process)** | crews / roles / tasks | 🟡 composition exists; needs the task/process layer |
| Structured data between steps | response-format / typed I/O | ❌ not built |
| Execution view / run history | run-viewer | ❌ not built |
| Triggers (webhook / schedule / event) | scheduled & triggered agents | ❌ not built |
| Create-a-node / create-an-agent | **agent-builder ⭐** | ❌ not built (seam in place) |
| **Shared agent memory (RAG + vector DB)** | memory subsystem | ❌ **not built — required, Phase B** |
| **Grounded answers / anti-hallucination** | verification layer (verifier/critic agents) | ❌ **not built — only passive "report a gap" today; Phase B** |
| Reliability / retries | graceful degradation | ❌ not built |

---

> **Cross-cutting design principle — grounded & trustworthy by default.** Every
> agent we build (and every agent the agent-builder generates) should *prefer
> abstention over fabrication*: answer from evidence (retrieved context, tool
> output, the user's files), cite it where it matters, and say "I don't know" or
> report a gap rather than guess. The system already does this passively
> (`report_capability_gap`, `{kind:'resource'}`); Phase B makes it active
> (faithfulness judging, citation enforcement, corrective re-retrieval). This is
> a property of the whole platform, not a single slice.

> **Cross-cutting design principle — observable by default (extend telemetry as we go).**
> Phase A's run-viewer establishes an **OpenTelemetry tracing layer** (`src/telemetry/`)
> that is **modular and meant to be extended by every feature we build after it.**
> The rule, going forward: **any new subsystem that does meaningful work emits
> spans/events** through the shared `src/telemetry/spans.ts` helpers (add a
> `withXSpan` helper + `ATTR` keys following the existing pattern) — the workflow/DAG
> engine (span per step/branch/fan-out), crews (span per role/task/process),
> memory/RAG (retrieve → rerank → generate spans + `gen_ai.*`), grounded
> verification (faithfulness/citation spans), agent-builder, triggers/daemon, and
> the Engine-line scheduler all extend the same trace. Because everything funnels
> through the OTel `SpanExporter` seam, the **local JSONL viewer and any OSS backend
> (Jaeger / Tempo / Phoenix / Honeycomb via `AGENT_OTLP_ENDPOINT`) get the new
> signal for free** — no re-instrumentation. **Telemetry is not a Phase-A
> deliverable that ends; it is a standing obligation of every later slice.** Each
> new spec/plan MUST include a "telemetry to emit" note. See
> `reference-otel-run-viewer-constraint` memory.

## Foundation — SHIPPED (the engine)

| Slice | Capability | Status |
|---|---|---|
| **1** | Local file-Q&A agent · model warm-up/unload · MCP `read_file` · run store | ✅ shipped + live-verified |
| **2** | Orchestrator (agents-as-tools) — route to a specialist or report a capability gap | ✅ shipped + live-verified |
| **3** | `mountMcpServer` (mount any MCP server) · web-fetch agent (`uvx mcp-server-fetch`) | ✅ shipped + live-verified |
| **4** | **Model Manager** — multi-model, hardware-aware: live free-RAM budget (`min(75% Metal cap, 80% available)` via `vm_stat`, per-delegation); load/evict/pin within budget; dynamic `num_ctx` from headroom, clamped by live model max, floored at 4096 | ✅ shipped + live-verified |
| **5** | **Dynamic model selection** — agents declare a capability requirement (`requires`/`prefer`); a registry + selector pick the largest model that fits; genuine no-fit → `{kind:'resource'}` + non-zero exit, never a hallucinated answer | ✅ shipped + live-verified |
| **6** | **Model discovery + multi-runtime** — `runDiscovery` fetches tool-capable GGUF/MLX models from Hugging Face (sized to live RAM), writes `catalog.json`, pre-pulls top fit; offline `buildRegistry` merge; Ollama + MLX-server runtime ports; four-axis taxonomy (capability/modality · runtime · source · content-policy) | ✅ shipped + live-verified |
| **7** | **KV-cache quantization** — global `AGENT_KV_CACHE_TYPE` (default `q8_0`) + `OLLAMA_FLASH_ATTENTION=1`; per-model arch-derived sizing from `/api/show`; generalized arch-risk advisory (head_dim ≤ 64 / MoE); zero family hardcoding | ✅ shipped + live-verified |

---

# The product line — toward n8n × CrewAI

Six themed phases. Sequence is a recommendation; phases A→D are the critical
path to a recognizable n8n/CrewAI experience. The **Engine line** and
**Capability breadth** run continuously alongside, pulled in opportunistically.

## Phase A — See it & trust it  *(cheap, high-leverage, unblocks everything)*

| Item | Why now | Depends on |
|---|---|---|
| **Run-viewer (`/runs`)** ⭐ | Instruments each run as an **OpenTelemetry trace** (root + delegation + model-lifecycle spans; AI-SDK gives agent/tool/token spans free) to `runs/<id>/spans.jsonl`, rendered as a terminal timeline (`bun run runs`, with `--follow`). Establishes the **extensible `src/telemetry/` layer every later feature emits into** (see the observable-by-default principle above) + a swappable OTLP backend seam. Makes 7 slices of invisible engine **demoable**, and becomes the **debugging surface** you'll need the instant workflows/crews/agent-builder start misrouting. Lowest cost, highest visibility. | run store (Slice 1) |
| **Graceful degradation** | If `uvx` / an MCP server / a model is down, **drop that agent and tell the user** instead of failing the whole CLI. Essential for an always-on autonomous box; today a dead dependency can sink a run. | Slices 2–3 |
| **Telemetry + eval harness** | Log per-agent latency / tokens / tool-call success; a small harness scoring **routing accuracy** (did the orchestrator pick the right specialist?) **and answer faithfulness / citation-faithfulness** (RAGAS-style: % of claims supported by retrieved evidence; penalize fabricated citations) against a ~100-item golden set. The moment agent-builder adds specialists *and* RAG adds retrieved context, routing quality + groundedness are what break — cheap insurance, measurable. | Slice 2 |

## Phase B — Compose it  *(the heart of n8n & CrewAI)*

| Item | Why | Depends on |
|---|---|---|
| **Composition guardrails** | **Prerequisite** for any multi-agent depth: delegation **depth limit** + cross-agent **cycle detection** + concise/summarized returns + warm-model reuse. The roadmap has long flagged these as MUST-haves; they must land **before** crews/agent-builder, or deep graphs become a cost/loop footgun (~15× compounding). | Slice 2 |
| **Workflow / DAG engine** ⭐ | The defining capability we lack vs **both** n8n and CrewAI: **deterministic multi-step orchestration** — a typed DAG of steps (agent call, tool call, branch, map/fan-out) with explicit data flow, instead of one LLM picking one specialist. This is the n8n "workflow" and the CrewAI "sequential process." | guardrails, run store |
| **Crews & roles** | The CrewAI layer on top of the engine: agents gain **role + goal**; a **task list** runs under a **process** (sequential pipeline or hierarchical = our orchestrator). Formalizes "a team of agents collaborating on a goal." | workflow engine |
| **Memory / RAG (vector DB)** ⭐ | **Required, not optional** — a file/doc-based store can't give semantic recall. Local-first & keyless: **Ollama embeddings** (`nomic-embed-text` default; `bge-m3` for long/multilingual docs) + an **embedded on-disk vector store** — recommend **LanceDB** (native TS SDK, disk-based ANN so it scales past RAM, built-in hybrid + reranking; sqlite-vec is the lighter alt but hits a `bun:sqlite`-can't-load-extensions snag on macOS). Best-practice retrieval pipeline: **semantic chunking → hybrid (BM25 + dense, RRF-fused) → rerank → top 5–8**. Long-term/structured memory in `bun:sqlite`. Powers CrewAI-style short/long-term/entity memory; sized & governed by the Model Manager like any other model. See `reference-rag-grounding-findings` memory. | workflow engine, Model Manager |
| **Grounded generation + verification** ⭐ | **Anti-hallucination as a first-class layer**, not an afterthought — and natural here because a **verifier/critic agent is just another agent** (`asDelegateTool`) and a workflow step. Techniques: **citation enforcement** (every claim cites a retrieved chunk-ID; uncited sentences stripped/rewritten); a **reference-free faithfulness judge** (extract claims → NLI-check each against retrieved chunks → % supported, the RAGAS method); **Corrective RAG** (grade retrieval; weak → rewrite query / re-retrieve before answering); **Chain-of-Verification** for complex multi-step answers; and **abstention** — extends the system's existing *"never hallucinate → report a gap"* stance from "no capability" to "no evidence." Multi-level scrutiny = layered verifier agents over the primary answer. | memory/RAG, workflow engine |
| **Structured / response-format I/O** | Workflows need typed hand-offs between steps (JSON / schema-validated output, markdown, tables). User already confirmed this **will** be needed. Also the substrate for citation enforcement (claims + chunk-IDs are structured). Unlocks reliable step-to-step data flow. | workflow engine |

## Phase C — Connect it  *(the integration library — n8n's 400 nodes)*

| Item | Why | Depends on |
|---|---|---|
| **Declarative `mcp.json` mount registry** | Generalizes Slice 3's in-code mounts: list servers + which agents get them, loaded at startup. The cheapest path to **real usefulness** and the **palette agent-builder suggests from**. | Slice 3 |
| **Starter integration pack** | A curated set of keyless/local MCP servers — filesystem, **web-search**, git/**GitHub**, SQLite/Postgres, shell — so the platform can actually *do* things across domains. *"Power comes from tools, not the agent shell."* | mount registry |
| **Codex heavy-lifting backup** | Opt-in `@openai/codex-sdk` delegate agent (personal plan) as the single cloud escape hatch for jobs local models can't handle — never default. | Slice 2 |

## Phase D — Grow it  *(self-extension — the ⭐ differentiator)*

| Item | Why | Depends on |
|---|---|---|
| **Agent-builder** ⭐ | On `report_capability_gap`, generate a new agent definition file **and suggest an MCP server to mount** — so *"describe a need → the system grows the capability."* The headline feature that makes the whole vision real; the gap seam is already in place. Needs B's guardrails (safe composition) + C's registry (servers to suggest). | Slices 2–3, B, C |

## Phase E — Run it always  *(triggers & automation — n8n's identity)*

| Item | Why | Depends on |
|---|---|---|
| **Always-on daemon + task queue** | The orchestrator as a background service: fire tasks, collect results later. | workflow engine |
| **Scheduled / triggered agents** | Cron- and event-driven (file added → process it) — the n8n "trigger" concept that turns workflows into **automations**. | daemon |
| **Resumable long jobs** (`--resume <run-id>`) | The run store + journal already support replay; wire resume for multi-hour jobs. | run store |
| **Multi-machine** | Laptop delegates heavy work to the Mac Mini over the network. | daemon |
| **A2A interop** | Expose this orchestrator as an agent other tools can call; consume external agents (Agent2Agent protocol). | daemon |

## Phase F — Capability breadth  *(pull in on demand — NOT the critical path)*

| Item | Why | Depends on |
|---|---|---|
| **Vision** (ex-Slice 8) | Activate the `Capability.Vision` seam; wire a local multimodal model (Gemma, LLaVA) as a specialist. Seam already typed in `src/core/types.ts`. | Slice 6 |
| **Audio** (ex-Slice 9) | Activate `Capability.Audio`; local Whisper STT + TTS specialist; pairs with voice-in/out UX. | Vision |
| **Video** (ex-Slice 10) | Activate `Capability.Video`; frame-sampling + vision-model description; resumable long jobs. | Audio |
| **Uncensored mode** (ex-Slice 11) | Activate the `ContentPolicy.Uncensored` seam; opt-in catalog source, explicit user flag, never default. | Slice 6 |
| **Voice in/out** | Local Whisper (STT) + local TTS → a voice agent (generalizes the book→audiobook idea). | Audio |
| **Streaming CLI** | Token-by-token output instead of waiting. | — |
| **TUI / local web UI** | Chat window + live "which agent / which model is loaded" panel + run-history browser (the visual layer over Phase A's run-viewer). | run-viewer |

---

## Engine line — continuous (the hardware-aware foundation keeps deepening)

Pulled in opportunistically as real load demands; not blocking the product line.

- **Reclaim (Slice 4.5)** — when memory is genuinely tight: degrade → ask once → kill non-essential apps (protected set kept). Slot in once memory pressure is real.
- **Explicit `maxLoaded` cap** — today concurrency is bounded only by live RAM headroom + Ollama's `OLLAMA_MAX_LOADED_MODELS` (default 3). A first-class count cap is needed for **deterministic parallel fan-out** (Phase B map/fan-out steps).
- **Parallel fan-out memory arbitration** — co-schedule concurrent specialists' combined footprints within the live budget (needs `maxLoaded` + a shared KV reservation table).
- **Global / lookahead scheduler** — pre-warm models and schedule delegations against a task DAG (composes directly with Phase B's workflow engine).
- **Quality-ranked selection + BFCL offline ranking** — attach benchmark/eval metadata to the catalog so the selector ranks by **quality-within-budget**, not pure size. (Slice 6 supplies the per-machine catalog; this adds the quality signal.)
- **Router-as-selected** — run the pinned router (`qwen3.5:4b`) through the selector too, so even routing is capability-declared and hardware-adaptive.
- **Fuller anti-churn / hysteresis** — don't evict a resident model unless the challenger is clearly better; cooldown after a recent load.
- **Interactive resource arbitration** — under genuine contention, surface a user-visible ask before killing processes (overlaps Reclaim; design together).
- **KV-cache follow-ons (Slice 7 §6):** per-model KV *type* enforcement (needs per-process runtimes — llama.cpp-server / vLLM / MLX); reserve-headroom / co-resident KV budgeting; **context compression (Headroom)** — compresses in-context history when the window fills (composes with KV quant; needs a quality spike on a local 9B first; see `reference-headroom-context-compression` memory); asymmetric K/V (blocked on Metal); server KV-type probe (read back the live server's actual KV type and warn on mismatch).
- **Ollama-native MLX on Mac Mini** — Ollama 0.19+ uses the MLX backend on 32 GB+ Apple Silicon automatically; discovery picks up larger MLX-backed models (e.g. `qwen3.5:14b+`) with no code change.

## Alternate runtimes & the Mac Mini era

- **Dedicated MLX-server / LM Studio adapters** — behind the same AI SDK `LanguageModel` interface: persistent KV-cache (omlx) or high concurrency (vMLX) for heavy agent loops when Ollama's sequential serving isn't enough.
- **Raw `llama.cpp`-server adapter** — low-level control (custom sampling/flags) if ever needed; Ollama stays the default.
- **Bigger models on the Mac Mini** — >32 GB unified memory hosts larger specialists (`qwen3.5:14b+`, `llama4:scout` long-context); the Model Manager already budgets to the host, so it's mostly a declaration change.

---

## ⭐ Recommended sequence (critical path to n8n × CrewAI)

1. **Run-viewer** (Phase A) — see the engine work; the cheapest high-value slice and the debugging surface everything later needs.
2. **Composition guardrails** (Phase B) — small, unblocks safe multi-agent depth.
3. **Workflow / crew engine + memory (RAG) + grounded verification** (Phase B) — the defining n8n/CrewAI capability we lack; crews need semantic memory (local embeddings + embedded vector DB) to be useful, and RAG without a **faithfulness/verification layer** just hallucinates more confidently — so engine + memory + grounding land together.
4. **`mcp.json` mount registry + starter pack** (Phase C) — make it genuinely useful; gives workflows things to *do* and agent-builder servers to *suggest*.
5. **Agent-builder** ⭐ (Phase D) — the self-extension headline; now safe (guardrails) and useful (integration library).
6. **Triggers / daemon** (Phase E) — turn workflows into automations (n8n's identity).

Reliability (graceful degradation, telemetry/eval) folds into Phase A alongside
the run-viewer. Modalities & memory (Phase F) come in on demand — not before the
product core exists.

---

## Deferred technical items (cross-cutting, fold in opportunistically)

- Migrate `biome.json` off the deprecated `recommended` field.
- **Per-slice Minor review findings** are recorded in `.superpowers/sdd/progress.md` (the SDD ledger) as each slice completes — e.g. run-journal O(n²) append, `runAgent.providerOptions` cross-package type, gap `message` hardcoded English. Sweep opportunistically; none blocking.
- **Hardware/context-aware guardrails for deeper composition** (recorded constraint): the workflow/crew/fan-out slices MUST bound delegation depth, add cross-agent cycle detection, reuse warm models (shared-model agents = one resident copy), keep returned answers concise, and schedule concurrency within the Model Manager's budget. Cost compounds ~15× for naive orchestrator-workers — depth/fan-out are bounded deliberately.
