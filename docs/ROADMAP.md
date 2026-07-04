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
model/resource management). Eleven more (Slices 8–18) have since landed the
first wave of the **product** pivot: an OTel run-viewer, composition
guardrails, a deterministic workflow/DAG engine, a crews & roles layer
composed on top of it, a persistent semantic memory layer (LanceDB +
`bun:sqlite`, optional cross-encoder rerank) crews/workflows can opt into, a
grounded-verification layer (claim decomposition, a MiniCheck faithfulness
judge, bounded Corrective RAG, abstention) that opts a crew/workflow run into
citation-checked, hallucination-resistant answers via `--verify`, first-boot
model provisioning (Slice 14, Ollama live-verified; LM Studio/llama.cpp/MLX
contract-tested, live-verify deferred), a declarative `mcp.json` mount
registry + 12-entry curated starter pack (Slice 15, consent-gated mounting,
spec-hash/tools-hash pinning against tool-definition drift, `bun run mcp
list|status|add`, replacing the 2 hardcoded mounts Slices 1–3 shipped), and
an MCP telemetry-ordering fix + consent robustness hardening (Slice 16). Phase
D now has its first slice too: **Slice 17's agent-builder** (`src/agent-builder/`)
turns *"describe a need"* into a reviewed, working specialist — generate a
proposal → suggest a minimal palette-only server subset → validate
structurally → consent → write, live on the next run. And **Slice 18** was a
**debt wrap-up + MLX completion** slice — one slice discharging the
dischargeable-now deferred work logged through Slice 17: the download/inference
enum split (`ProviderKind` vs `RuntimeKind`), `hf-fetch` actually persisting
weights to disk (atomic + oid-verified), the MLX inference runtime raised to
Ollama's bar (opt-in + degrade), and the accumulated Slice-14/15/16/17 polish
(bounded-parallel downloads, truthful telemetry, engine-enforced read-only
sqlite, MCP OAuth wiring, an inert agent-builder tool-code path) — MLX
live-verified both ways. The **product surface** is still thin beyond that: 3
built-in agents (`super`, `file-qa`, `web-fetch`) plus whatever the
agent-builder has grown; no crew/workflow builder yet (only individual
specialists); no execution dry-run or reuse tracking for generated agents (the
Phase-D breadth work, now **Slice 19+**).

| n8n / CrewAI concept | Our analog | Status |
|---|---|---|
| AI-agent node (model + prompt + tools + loop) | `Agent` (`src/core/agent.ts`) | ✅ built |
| Hierarchical process / supervisor | orchestrator (agents-as-tools) | ✅ built |
| Self-hosted, your infrastructure | local-first, Ollama, Mac Mini | ✅ core premise |
| Hardware-aware scheduling | Model Manager (live RAM budget, KV quant) | ✅ built (Slices 4–7) |
| Integration library (n8n's 400+ nodes) | mounted MCP servers | ✅ `mcp.json` registry + 12-entry pack (Slice 15) |
| **Workflow / DAG (deterministic steps)** | **workflow engine** | ✅ **built (Slice 10)** |
| **Crew (role + goal + task + process)** | crews / roles / tasks | ✅ built (Slice 11) |
| Structured data between steps | response-format / typed I/O | ✅ built (Slice 10 — Zod-validated step I/O) |
| Execution view / run history | run-viewer | ✅ built (Slice 8 — OTel trace + `bun run runs`) |
| Triggers (webhook / schedule / event) | scheduled & triggered agents | ❌ not built |
| Create-a-node / create-an-agent | **agent-builder ⭐** | ✅ **shipped (Slice 17)** |
| **Shared agent memory (RAG + vector DB)** | memory subsystem | ✅ **built (Slice 12)** |
| **Grounded answers / anti-hallucination** | verification layer (verifier/critic agents) | ✅ **built (Slice 13)** |
| Reliability / retries | graceful degradation | ❌ not built |

---

> **Cross-cutting design principle — grounded & trustworthy by default.** Every
> agent we build (and every agent the agent-builder generates) should *prefer
> abstention over fabrication*: answer from evidence (retrieved context, tool
> output, the user's files), cite it where it matters, and say "I don't know" or
> report a gap rather than guess. The system already did this passively
> (`report_capability_gap`, `{kind:'resource'}`); Phase B made it active
> (Slice 13: faithfulness judging via `bespoke-minicheck`, citation
> enforcement through cited-evidence lookup, bounded corrective re-retrieval,
> and an explicit `{kind:'unverified'}` abstain outcome, opt-in via
> `--verify`). This is
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
| **Run-viewer (`/runs`)** ⭐ — ✅ **shipped (Slice 8)** | Instruments each run as an **OpenTelemetry trace** (root + delegation + model-lifecycle spans; AI-SDK gives agent/tool/token spans free) to `runs/<id>/spans.jsonl`, rendered as a terminal timeline (`bun run runs`, with `--follow`). Establishes the **extensible `src/telemetry/` layer every later feature emits into** (see the observable-by-default principle above) + a swappable OTLP backend seam. Makes 7 slices of invisible engine **demoable**, and becomes the **debugging surface** you'll need the instant workflows/crews/agent-builder start misrouting. Lowest cost, highest visibility. | run store (Slice 1) |
| **Graceful degradation** | If `uvx` / an MCP server / a model is down, **drop that agent and tell the user** instead of failing the whole CLI. Essential for an always-on autonomous box; today a dead dependency can sink a run. | Slices 2–3 |
| **Telemetry + eval harness** | Log per-agent latency / tokens / tool-call success; a small harness scoring **routing accuracy** (did the orchestrator pick the right specialist?) **and answer faithfulness / citation-faithfulness** (RAGAS-style: % of claims supported by retrieved evidence; penalize fabricated citations) against a ~100-item golden set. The moment agent-builder adds specialists *and* RAG adds retrieved context, routing quality + groundedness are what break — cheap insurance, measurable. | Slice 2 |

## Phase B — Compose it  *(the heart of n8n & CrewAI)*

| Item | Why | Depends on |
|---|---|---|
| **Composition guardrails** — ✅ **shipped (Slice 9)** | **Prerequisite** for any multi-agent depth: an `AsyncLocalStorage` delegation context enforcing a **depth limit** (default 5, termination-guaranteed, `AGENT_MAX_DELEGATION_DEPTH`; recursion within the limit is allowed) + a **live return-size cap** (¼ × caller `num_ctx`, `AGENT_RETURN_CTX_FRACTION`) + soft-error surfacing via an `agent.guardrail.violation` span event. The roadmap has long flagged these as MUST-haves; they landed **before** the workflow engine, crews, and agent-builder, so deep graphs don't become a cost/loop footgun (~15× compounding). | Slice 2 |
| **Workflow / DAG engine** ⭐ — ✅ **shipped (Slice 10)** | The defining capability we lacked vs **both** n8n and CrewAI: **deterministic multi-step orchestration** — `defineWorkflow({id, steps})` builds a code-first, typed, JSON-serializable DAG of steps (`agent` / `tool` / `branch` / `map` fan-out) with Zod-validated data flow between them, instead of one LLM picking one specialist. Fail-fast by default with a per-step `onError: 'continue' \| {fallback}` escape hatch; bounded map concurrency. Run via `bun run flow <name>`, backed by the `workflows/` registry and `runWorkflow()`; agent steps reuse the Slice 9 guardrails through a shared `runGuardedAgent`. This is the n8n "workflow" and the CrewAI "sequential process." | guardrails, run store |
| **Crews & roles** ⭐ — ✅ **shipped (Slice 11)** | The CrewAI layer on top of the engine, composed (not a new engine): `defineCrew({id, members, tasks, process})` — members carry **role + goal + backstory** (composed into the system prompt, model resolved live by the selector) and a dependent **task list** runs under a **process**, either `sequential` (compiles to a Slice-10 workflow DAG) or `hierarchical` (reuses the orchestrator + an auto manager). Reuses the Slice 9 guardrails; emits `crew.run` / `crew.step` telemetry. Run via `bun run crew <name>`, backed by the `crews/` registry. Formalizes "a team of agents collaborating on a goal." | workflow engine |
| **Memory / RAG (vector DB)** ⭐ — ✅ **shipped (Slice 12)** | Local-first & keyless: `src/memory/` — **LanceDB** (embedded, table-per-space) + **`bun:sqlite`** (space registry authoritative for embedder+dim, `(space,source)`-scoped ingestion manifest); default embedder `qwen3-embedding:0.6b`, loaded weights-only through the Model Manager. Retrieval pipeline **as shipped**: semantic/fixed chunking → **dense vector search** (FTS index created opportunistically; hybrid BM25+dense fusion **not yet wired** — a deliberate follow-up, not the originally-planned default) → **optional cross-encoder rerank, default-ON** (`transformers.js`/ONNX `Xenova/bge-reranker-base`; the Task-13 viability spike passed on Apple Silicon; `AGENT_MEMORY_RERANK=0` to disable; degrades gracefully to pre-rerank order on failure) → live budget-fit pack. Citation-tagged (`[mem:<id>]`) + explicit abstention (`"No supporting memory found."`) — the anti-hallucination primitives Slice 13 builds on. `bun run memory ingest\|recall\|stats\|reindex`; `runCrew`/`runWorkflow` accept an optional `memory` dep (bound `recall` tool + auto-persist), though the `flow`/`crew` CLIs don't yet construct a real store by default. See `reference-rag-grounding-findings` memory and [`docs/architecture.md`](architecture.md) §11. | workflow engine, Model Manager |
| **Grounded generation + verification** ⭐ — ✅ **shipped (Slice 13)** | **Anti-hallucination as a first-class layer**, not an afterthought: `src/verification/` decomposes an answer into claims (`claims.ts`), fetches **exactly the memory chunks each claim cites** (`getByIds` — fusing citation enforcement with faithfulness checking: an uncited claim is unsupported by construction), and checks each claim against its own evidence with a **reference-free faithfulness judge** — `bespoke-minicheck`, a small model fine-tuned for `(document, claim) → supported?`, consent-pulled on first use and falling back to the general model rather than hard-failing (`judge.ts`, `deps.ts`). **Corrective RAG** grades the retrieval and, if weak, rewrites the query and re-answers; re-retrieval happens when a `recall` dependency is wired (the current `--verify` CLI path re-answers without fresh retrieval, a documented follow-up, mirroring the memory-store CLI gap), once (a bounded, unrolled step — not a runtime loop, since the workflow engine has no native loop construct) before finalizing the answer (`crag.ts`). **Abstention**: if the final gate still fails, the run returns `{kind:'unverified'}` with the unsupported draft captured but never presented, extending the system's existing *"never hallucinate → report a gap"* stance from "no capability" to "no evidence." Opt-in and additive — a task/crew/workflow flags `verify: true`, or the CLI passes `--verify`, and the compiler splices a verify→branch→corrective→abstain sub-graph (`StepKind.Verify`, `expand.ts`) after the **terminal** answering step (a documented v1 limitation: a mid-graph verified step's downstream deps still see the original, unverified value). Eval gate is an **in-repo golden set** (~20 cases), not an external framework (RAGAS, etc. — deferred). Also deferred: Chain-of-Verification, semantic-entropy/self-consistency uncertainty estimation, Self-RAG, generation-time citation constraints, per-task `--verify` granularity. See [`docs/architecture.md`](architecture.md) §12. | memory/RAG, workflow engine |
| **Structured / response-format I/O** | Workflows need typed hand-offs between steps (JSON / schema-validated output, markdown, tables). User already confirmed this **will** be needed. Also the substrate for citation enforcement (claims + chunk-IDs are structured). Unlocks reliable step-to-step data flow. | workflow engine |

## Phase C — Connect it  *(the integration library — n8n's 400 nodes)*

| Item | Why | Depends on |
|---|---|---|
| **Declarative `mcp.json` mount registry** — ✅ **shipped (Slice 15)** | Generalizes Slice 3's in-code mounts: list servers + which agents get them, loaded at startup. The cheapest path to **real usefulness** and the **palette agent-builder suggests from**. | Slice 3 |
| **Starter integration pack** — ✅ **shipped (Slice 15)** | A curated set of keyless/local MCP servers — filesystem, SQLite, **web-search** (Brave/Exa), git/**GitHub**, time, browser (Playwright) — so the platform can actually *do* things across domains. *"Power comes from tools, not the agent shell."* (Postgres/shell not in the pack — no maintained official server; shell needs a sandboxing design, see Slice 15 follow-ons.) | mount registry |
| **Codex heavy-lifting backup** | Opt-in `@openai/codex-sdk` delegate agent (personal plan) as the single cloud escape hatch for jobs local models can't handle — never default. | Slice 2 |

## Phase D — Grow it  *(self-extension — the ⭐ differentiator)*

| Item | Why | Depends on |
|---|---|---|
| **Agent-builder** ⭐ — ✅ **shipped (Slice 17)** | On a reported capability need (`report_capability_gap`'s TTY offer, or a direct `bun run agent-builder "<need>"`), `src/agent-builder/` drafts a new agent definition (`generate.ts`, prompt-injection-guarded) **and suggests a minimal palette-only MCP-server subset to mount** (`suggest-tools.ts`, from the Slice 15 pack) — *"describe a need → the system grows the capability."* Structurally validated (`validate.ts`), consent-gated (review-before-activate — no write without an explicit yes), then written atomically: the agent file, a new `agents/index.ts` registry entry, and a scoped `mcp.json` (`write.ts`, `builder.ts`). Live on the *next* run, not the one that discovered the gap — no same-run activation, no tool-code generation, no OAuth. See [`docs/architecture.md`](architecture.md) §18. | Slices 2–3, B, C ✅ |
| **Crew/workflow builder** (next Phase-D slice — **Slice 19**) | Slice 17 grows *individual* specialists only; composing several existing + newly-generated agents into a crew or workflow (roles/tasks/process, or a DAG) still requires hand-writing a `crews/`/`workflows/` definition. The natural next step toward "chat → any agent/crew out of the box": describe a multi-step need, and the builder proposes + writes a crew/workflow that wires generated and existing agents together. | Slice 17 |
| **Verified "works out of the box"** (**Slice 19+**) | Today a generated agent is *structurally* valid (`validate.ts`) but never actually run before being handed to the user — there's no proof it behaves as intended. The path to a genuinely verified "just works": (1) an **execution dry-run** — invoke the freshly-written agent against a small representative task the moment it's created, before declaring success; (2) a **golden-eval** per generated agent (a few need→expected-behavior cases, mirroring the verification layer's golden-set pattern, §12); (3) **reuse/archive** — detect when a new need matches an already-generated agent closely enough to reuse it instead of generating a near-duplicate, and archive/prune agents that stop being used. None of these three exist yet. | Slice 17 |

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

> **Slice 14 laid the download half; Slice 18 completed the MLX end.** Slice 14
> shipped a runtime-agnostic `DownloadProvider` + `CatalogSource`; **Slice 18** split
> the download `ProviderKind` from the inference `RuntimeKind`, made `hf-fetch`
> actually persist weights to disk (atomic + HF-LFS-oid-verified), raised **MLX** to a
> full inference runtime (`createMlxServerRuntime`, opt-in + degrade-to-Ollama) and
> **live-verified it both ways**, and **wired LM Studio's download adapter into
> `providerFor`** under its own `ProviderKind.LmStudio`. What remains — **explicitly
> deferred, must be included in future** — is (a) standing **LM Studio & llama.cpp** up
> as full **inference** runtimes (chat/completions behind the AI SDK `LanguageModel`
> interface, not just download), and (b) **live-verifying the LM Studio & llama.cpp
> download adapters** once installed on a test machine (Ollama + MLX-snapshot are
> live-verified; LM Studio ships contract-tested with live-verify logged-deferred).

- **Dedicated MLX-server adapter** — ✅ **shipped (Slice 18)**: `createMlxServerRuntime` behind the AI SDK `LanguageModel` interface (OpenAI-compatible `mlx_lm.server` at `MLX_BASE_URL`), opt-in via a declaration's `runtime` + degrade-to-Ollama, live-verified. Heavier variants (persistent KV-cache via omlx, high concurrency via vMLX) slot behind the same interface when Ollama's sequential serving isn't enough.
- **Dedicated LM Studio adapter** — download side wired (Slice 18); LM Studio as a full **inference** runtime is deferred (not installed on the dev machine).
- **Raw `llama.cpp`-server adapter** — low-level control (custom sampling/flags) if ever needed; Ollama stays the default. *(Download side lands via the shared HF-fetch GGUF adapter, live in Slice 18; a dedicated inference adapter + live-verify deferred.)*
- **Bigger models on the Mac Mini** — >32 GB unified memory hosts larger specialists (`qwen3.5:14b+`, `llama4:scout` long-context); the Model Manager already budgets to the host, so it's mostly a declaration change.

---

## ⭐ Recommended sequence (critical path to n8n × CrewAI)

1. ✅ **Run-viewer** (Phase A) — shipped, Slice 8. See the engine work; the cheapest high-value slice and the debugging surface everything later needs.
2. ✅ **Composition guardrails** (Phase B) — shipped, Slice 9. Small, unblocks safe multi-agent depth.
3. ✅ **Workflow / DAG engine** (Phase B) — shipped, Slice 10. The defining n8n/CrewAI capability we lacked.
4. ✅ **Crews & roles** (Phase B) — shipped, Slice 11. The CrewAI role/task/process layer, composed on the workflow engine + orchestrator.
5. ✅ **Memory / RAG** (Phase B) — shipped, Slice 12. Persistent semantic memory (LanceDB + `bun:sqlite`, weights-only embedder via the Model Manager, dense retrieval + optional default-on cross-encoder rerank) that crews/workflows can opt into via a `recall` tool + auto-persist.
6. ✅ **Grounded verification** (Phase B) — shipped, Slice 13. Closes the retrieve-then-hallucinate loop Slice 12 opened: claim decomposition, cited-evidence lookup, a MiniCheck faithfulness judge (consent-pull + fallback), bounded Corrective RAG, and an explicit abstain outcome, opt-in via `--verify`.
7. ✅ **shipped, Slice 14** — **First-boot model provisioning + runtime-agnostic downloader**. A fresh clone/machine used to need manual `ollama pull`s for the router, specialists, embedder, and the verification judge (`bespoke-minicheck`); `bun run provision` (plus a non-invasive `chat.ts` auto-detect hook) now runs a guided flow (detect hardware → discover fitting models → per-model consent → download with a **live progress UI** [bytes/%/speed/ETA] → hand off to `ensureReady` on the next normal run), removing that friction. Built **runtime-agnostic** behind a `DownloadProvider` abstraction + unified progress protocol covering **all four runtimes** (Ollama + LM Studio delegating; llama.cpp + MLX via one shared HuggingFace fetcher) — LM Studio's delegating adapter was implemented + contract-tested here but not yet routed via `providerFor` at the time (**wired into `providerFor` under its own `ProviderKind.LmStudio` in Slice 18** — see item 9c). Discovery is **dynamic per-runtime query with a committed-snapshot fallback** (Ollama registry-manifest sizes; HF tree sizes; LM Studio SDK). Also removes the root cause of the Slice-13 selector crash (declaring models without guaranteeing install). **Live-verified on Ollama** (only runtime installed on the dev machine); **LM Studio / llama.cpp / MLX adapters ship contract-tested with live-verify explicitly deferred + logged** (see Deferred items below) — never a silent skip; the HF-fetch adapter was additionally shape-complete but not yet disk-persisting at the time (no `.part`+rename, placeholder SHA256) — **made truly disk-persisting (atomic `.part`→rename, real HF-LFS-oid verification) + live-verified in Slice 18** (item 9c). Spec: `docs/superpowers/specs/2026-07-01-slice-14-provisioning-design.md`.
8. ✅ **shipped, Slice 15** — **`mcp.json` mount registry + starter pack** (Phase C). Replaces Slice 3's two hardcoded mounts with a declarative registry (`src/mcp/config.ts`, per-server `agents` scoping, per-entry degrade) + consent-gated mounting with spec-hash/tools-hash pinning against tool-definition drift (`consent.ts`, `mount.ts`) + a 12-entry curated starter pack (`pack.ts`, `bun run mcp list\|status\|add`) — files, SQL, memory, reasoning, web-fetch, git, time, browser, GitHub, web-search; key-gated entries stay dormant until their env var is set. Makes workflows/crews genuinely useful *now* and gives the agent-builder a palette to suggest from. Spec: `docs/superpowers/specs/2026-07-02-slice-15-mcp-mounts-design.md`.
8a. ✅ **shipped, Slice 16** — **MCP telemetry-ordering fix + consent robustness**. A live-verify pass on Slice 15 found the `mcp.mount` span was recorded before that run's telemetry provider existed, so it silently never reached `runs/<id>/spans.jsonl`; `src/cli/with-mcp-run.ts` now owns `createRun` → `initRunTelemetry` → mount (in that order) for all three CLIs, fixing it. The mount span also gained a `mcp.server.count` attribute and a corrected (summed) `mcp.tool.count`. Consent prompting is now judged on stdin **and** stderr both being TTYs, closing a hang on piped-closed stdin. See `docs/architecture.md` §14.
9. ✅ **shipped, Slice 17** — **Agent-builder** ⭐ (Phase D) — the self-extension headline; now safe (guardrails) and useful (integration library). `src/agent-builder/` sequences generate (prompt-injection-guarded) → suggest (palette-only, from the Slice 15 pack) → validate (structural) → consent (mandatory) → write (atomic: agent file + a new `agents/index.ts` registry entry + scoped `mcp.json`), under an `agent.build` telemetry span. Two triggers: `bun run agent-builder "<need>"` and a TTY-gated offer on `chat.ts`'s existing `{kind:'gap'}` outcome (unchanged, purely additive). Safety model: review-before-activate, palette-only tools, no same-run activation (live next run only). See `docs/architecture.md` §18.
9c. ✅ **shipped, Slice 18** — **Debt wrap-up + MLX completion**. One slice discharging the dischargeable-now deferred work logged through Slice 17: split the overloaded `ProviderKind` into a download `ProviderKind` + an inference `RuntimeKind` (`kind-map.ts` bridges them); made `hf-fetch` **actually persist weights to disk** (atomic `.part`→rename, HF-LFS-oid verify-when-present, single-file GGUF + MLX snapshot, traversal-guarded, retry/stall parity); raised **MLX** to a full inference runtime (`createMlxServerRuntime`, opt-in + degrade-to-Ollama via `fallbackModel`), **live-verified both ways** (direct `mlx_lm.server` + real HF-snapshot download + Ollama regression); wired **LM Studio's download** adapter into `providerFor`; and cleared the accumulated Slice-14/15/16/17 polish (bounded-parallel downloads + `MultiProgressBar`, truthful `provision.*` telemetry, an injectable Metal reader + `bytesPerWeight` 0.6, an engine-enforced read-only sqlite gate via `PRAGMA query_only`, MCP OAuth `authProvider` [contract-tested], `mcp.transport`, an atomic `addPackEntry`, and a consent-gated agent-builder tool-code path writing an inert `.proposal.ts`). Deferred with reasons (below): LM Studio / llama.cpp *inference* runtimes, the live OAuth handshake, GitHub-PAT live-verify, TS-SDK-v2 migration. See `docs/architecture.md` §5/§13/§14/§18.
### Committed forward plan (Slices 19–30) — locked 2026-07-04

This is the full remaining sequence, agreed with the user so direction is not
re-litigated each session. Ordering is dependency-forced except where noted;
debt is placed where it unblocks the next phase.

**Full-throttle posture (user directive 2026-07-04):** from Slice 19 on, every
slice ships **complete** — the whole capability (not a v1 subset), all edge
cases, all minors, all bugs, all scoping resolved, live-verified — within that
same slice. **No new deferred follow-ons.** If a slice hits a genuinely external
blocker (uninstalled runtime, missing credential, upstream API frozen till GA),
it is either acquired in-slice (the Slice-18 "install mlx-lm ourselves" pattern)
or raised to the user as a hard blocker — never silently punted. The pre-Slice-19
"Deferred follow-ons" sections below are the *existing* debt to burn down (e.g.
Slice 26), not license to create more.

10. **Crew/workflow builder** ⭐ (Phase D, **Slice 19 — next**) — Slice 17 only grows *individual* specialists; composing generated + existing agents into a multi-step crew or workflow still needs a hand-written definition. Extends the generate→suggest→validate→consent→write pattern one level up: describe a multi-step need, get a proposed `crews/`/`workflows/` definition wiring agents together, review it, write it. **Key design constraint:** `WorkflowDef`/`CrewDef` carry live closures (`input`/`predicate`/`over`) + Zod schemas and are **not JSON-serializable**, so the builder must emit **TS source** (agent-builder `write.ts` model) or introduce a serializable IR that compiles to those types — decided in the slice spec.
11. **Verified "works out of the box"** (Phase D + Phase-A eval, **Slice 20**) — an execution **dry-run** the moment an agent/crew is written, a per-agent/crew **golden-eval** (mirrors the verification golden-set pattern, §12), and **reuse/archive** (reuse a near-duplicate instead of generating; prune unused). Folds in Phase-A's deferred **telemetry+eval harness**. Moves validation from structural → behavioral; closes Phase D.
12. **Graceful degradation + retries** (Phase A, **Slice 21**) — the last Phase-A gap: retry policies, fallback-model degradation, partial-failure handling across delegation/workflow. Reliability the daemon (Slice 24) leans on.
13. **Codex heavy-lifting backup** (Phase C, **Slice 22**) — the last Phase-C item: tier-2 cloud delegate via `@openai/codex-sdk` (consent + cost design) for jobs too big for local models.
14. **Dependency major-upgrade** (foundation, **Slice 23**) — `ai` 6→7, `typescript` 5→6, `@ai-sdk/mcp` 1→2, `@ai-sdk/openai-compatible` 1→3; re-green all tests. Placed **immediately before Phase E** deliberately: AI SDK 7's headline is `WorkflowAgent` + durable/resumable execution — the exact substrate Phase E needs. Doing it earlier is churn with no payoff. See `deferred-dependency-major-upgrades` memory.
15. **Always-on daemon + task queue + resumable jobs + secure remote access** (Phase E, **Slice 24**) — `--resume <run-id>` (run store/journal already replay-capable), built on the Slice-23 `WorkflowAgent`. n8n's always-on identity begins here. **Includes secure remote access (user requirement 2026-07-04): drive the Mac-Mini daemon from anywhere** — an authenticated network entry point (API surface + auth/token; tunnel such as Tailscale/Cloudflare or reverse proxy rather than raw port exposure; TLS). Distinct from Slice 30's multi-machine *delegation* and A2A. Carries a real security/threat-model surface, so it gets explicit design in the slice spec (may split into its own sub-slice if scope demands).
16. **Scheduled + triggered agents** (Phase E, **Slice 25**) — cron/webhook/event triggers. Depends on the daemon.
17. **Alternate-runtime + remote-auth completion** (debt, **Slice 26**) — stand up **LM Studio + llama.cpp** as full *inference* runtimes + live-verify their download adapters; live **OAuth** handshake (PKCE/browser/token persistence) + **GitHub-PAT** remote-HTTP live-verify. *Gated on installing those runtimes / having creds — may slot earlier the moment hardware/creds exist.*
18. **Multimodal input: vision + audio + video** (Phase F, **Slice 27**) — on-demand breadth, off the critical path.
19. **Voice in/out + streaming CLI** (Phase F, **Slice 28**).
20. **TUI / local web UI** (Phase F, **Slice 29**) — the visual surface; reuses the pure `render-trace.ts` renderers. Uncensored mode as a config option here.
21. **Multi-machine + A2A interop** (Phase E, **Slice 30 — last**) — laptop delegates heavy work to the Mac Mini; expose this orchestrator as an agent others can call + consume external agents via A2A. **Moved to the very end** (user directive 2026-07-04): everything runs Mac-Mini-local by default and nothing else depends on it.

> **North star for the D→E arc:** a user should be able to describe *any* need
> in chat — one specialist, a multi-step crew, a scheduled automation — and
> have the system either **run it now** (an existing agent/crew) or
> **grow it, verify it, and then run it**, entirely out of the box, with no
> hand-written definition required. Slice 17 proves the *generate a
> specialist* half; the crew/workflow builder (Slice 19) proves the *compose a
> crew/workflow* half; the verified-out-of-the-box work (Slice 20) closes
> the gap between "structurally valid" and "actually verified to work."

Modalities & multi-machine (Phases F + the deferred A2A) come in on demand —
after the compose→verify→automate core exists.

---

## Deferred technical items (cross-cutting, fold in opportunistically)

- Migrate `biome.json` off the deprecated `recommended` field.
- **Per-slice Minor review findings** are recorded in `.superpowers/sdd/progress.md` (the SDD ledger) as each slice completes — e.g. run-journal O(n²) append, `runAgent.providerOptions` cross-package type, gap `message` hardcoded English. Sweep opportunistically; none blocking.
- **Hardware/context-aware guardrails for deeper composition** (recorded constraint): the workflow/crew/fan-out slices MUST bound delegation depth, add cross-agent cycle detection, reuse warm models (shared-model agents = one resident copy), keep returned answers concise, and schedule concurrency within the Model Manager's budget. Cost compounds ~15× for naive orchestrator-workers — depth/fan-out are bounded deliberately.

### Slice 14 follow-ons (deferred deliberately — MUST be included in future, not dropped)

Recorded so nothing is silently lost (see the Slice-14 spec §13 + `provisioning-runtime-agnostic` memory):
- ~~**HF-fetch disk persistence + real SHA256**~~ — ✅ **shipped (Slice 18)**: `hf-fetch.ts` now streams to `<destDir>/<file>.part`, hashes, **verifies against the HF LFS `oid` when present** (else compute-and-records), emits `Finalizing`, and atomically `rename`s to the final path — for both single-file GGUF and whole-repo MLX snapshots; `safeJoin` guards traversal and a write-stream `error` listener turns EACCES/ENOSPC into a `ProviderError`. **Live-verified** on a real MLX snapshot.
- ~~**MLX live-verify**~~ — ✅ **shipped (Slice 18)**: MLX raised to a full inference runtime and verified both ways (direct `mlx_lm.server` inference + real HF-snapshot download + an Ollama regression pass).
- ~~**Wire `createLmStudioProvider` into `providerFor`**~~ — ✅ **shipped (Slice 18)**: the enum split gave LM Studio its own `ProviderKind.LmStudio`, and `providerFor` routes it (no longer sharing `MlxServer` with HF-fetch).
- ~~**Snapshot-catalog refresh automation**~~ — ✅ **shipped (Slice 18)**: `scripts/refresh-snapshot.ts` re-derives each `snapshot.json` entry's `file_size_bytes` from the live source (manual, no cron), degrade-per-entry, writes-only-on-valid-changed-result; live-verified against the Ollama registry.
- ~~**Parallel multi-model downloads** (multi-bar)~~ — ✅ **shipped (Slice 18)**: TTY-gated `DOWNLOAD_CONCURRENCY=2` worker pool + `MultiProgressBar` (per-model failure isolation preserved in both the parallel and sequential-fallback paths).
- ~~**Live Metal read + `bytesPerWeight` bump**~~ — ✅ **partially shipped (Slice 18)**: `bytesPerWeight` bumped 0.56→0.6 (Q4_0/Q4_K_M) and an injectable Metal reader added (`HardwareDeps.readMetalWorkingSetBytes`, default reads `AGENT_METAL_WORKING_SET_BYTES`); a native `recommendedMaxWorkingSetSize` syscall read (no env) is still open — the seam is in place for it.
- **Live-verify the LM Studio / llama.cpp download adapters** once each runtime is installed on a test machine (Ollama + MLX-snapshot are live-verified; LM Studio ships contract-tested with live-verify logged-deferred). Standing obligation, not optional. *Still outstanding.*
- **Stand up LM Studio & llama.cpp as full inference runtimes** (chat/completions wiring, not just download) — see "Alternate runtimes" above. *Still deferred (not installed on the dev machine).*
- **`gpustack/gguf-parser-go`** for remote-header size + VRAM estimate across backends — deferred as a **documented keep-decision** (Go binary; HF-tree + Ollama-manifest sizes + `footprint.ts` VRAM suffice; a comment in `fit.ts` records this).

### Slice 15 follow-ons (deferred deliberately — MUST be included in future, not dropped)

Recorded so nothing is silently lost (see the Slice-15 spec §12 + `docs/architecture.md` §14):
- **Codex heavy-lifting backup** (Phase C) — own slice; cloud-delegation consent + cost design deserves its own spec.
- **OAuth for remote servers** (`authProvider`) — ⚠️ **contract-wired (Slice 18), live deferred**: `resolveAuthProvider` now passes an injected `OAuthClientProvider` into the HTTP transport when an entry declares `auth.kind = OAuth` (`McpAuthKind`), degrading to a warn-and-mount-without-auth when no provider is registered — contract-tested against a mock provider. The **live OAuth handshake** (PKCE / browser flow / token persistence) is still its own unit of work; today's `github`/`brave-search`/`exa-search` pack entries remain static-key only.
- **Live official-registry query** (`registry.modelcontextprotocol.io`) — API frozen at v0.1, GA pending; the curated pack is the value today. Revisit when GA.
- **Shell server** — arbitrary command execution needs a sandboxing design; no maintained official server exists yet, so it's deliberately excluded from the pack.
- **`list_changed` / notifications** — unsupported by the AI SDK client and itself a rug-pull vector; **pinning + re-prompt-on-drift is the deliberate posture**, not a live-notification subscription.
- **Roots / sampling** — entering 12-month deprecation in spec 2026-07-28; do not build.
- **Spec-2026-07-28 / TS-SDK-v2 migration** — the stateless core lands ~4 weeks after this slice; a small follow-on once the SDK v2 is stable.
- ~~**`mcp.mount` span/run-telemetry ordering gap**~~ — ✅ **shipped (Slice 16)**: `src/cli/with-mcp-run.ts`'s `withMcpRun` now owns `createRun` → `initRunTelemetry(run.dir)` → `withMcpMountSpan(mountAll(...))` in one place for all three CLIs, so the run's tracer provider is registered *before* mounting and `mcp.mount` (with its `mcp.server.mount` events) now lands in `runs/<id>/spans.jsonl`. `runFlow`/`runCrewCli`/`runChat` now take `run: RunHandle` from the caller instead of creating it themselves. See `docs/architecture.md` §14 Telemetry.
- ~~**`mcp.tool.count` rename/semantics**~~ — ✅ **shipped (Slice 16)**: `withMcpMountSpan`'s root span now sets `mcp.server.count` (servers actually mounted) and a corrected `mcp.tool.count` — the **sum** of those servers' tool counts — replacing the previous raw per-call record count that had no clear meaning.
- ~~**`sqlite` pack entry needs `data/` to pre-exist**~~ — **fixed pre-merge (Slice 15 final review)**: `bun:sqlite` doesn't create parent directories for its default `data/agent.db` path, so `src/mcp/sqlite-server.ts` now calls `mkdirSync(dirname(dbPath), { recursive: true })` before opening the database; a bare clone's first `bun run mcp add sqlite` mount now succeeds without a manual `mkdir -p data`. Covered by a new nested-tmp-dir assertion in `tests/mcp/sqlite-server.test.ts`.
- ~~**Consent stdin/TTY edge case**~~ — ✅ **shipped (Slice 16)**: `interactiveTTY()` (`src/provisioning/ui/prompt.ts`) now requires **both** stdin and stderr to be TTYs before prompting — judging on stderr alone let `bun run flow ... < /dev/null` hang on an already-ended stdin — and `stdinInput()` resolves `''` on the stream's `end` event instead of leaving the read promise pending.
- **GitHub remote-HTTP live-verify** — the `github` pack entry (Streamable HTTP + PAT header) shipped contract-tested; live-verify deferred until a `GITHUB_PAT` is available (recorded in architecture.md §14 + SDD ledger). *Still outstanding.*
- **Interactive consent-prompt UX live-verify** — headless consent (`AGENT_MCP_AUTO_APPROVE=1`) live-verified; the interactive TTY y/N prompt path is unit-tested but awaits a first real terminal run. *Still outstanding.*

### Slice 17 follow-ons (deferred deliberately — MUST be included in future, not dropped)

Recorded so nothing is silently lost (see `docs/architecture.md` §18):
- **Crew/workflow builder** (next Phase-D slice — **Slice 19**) — Slice 17 only grows individual specialists; composing generated + existing agents into a multi-step crew or workflow still needs a hand-written `crews/`/`workflows/` definition. Extends the same generate→suggest→validate→consent→write pattern one level up.
- **Execution dry-run at write-time** — a freshly-written agent is validated structurally (`validate.ts`) but never actually run before being handed to the user; no proof it behaves as intended. Invoking it against a small representative task at build time is the first step toward a genuinely *verified* "works out of the box."
- **Per-agent golden-eval** — mirror the verification layer's golden-set pattern (§12): a few need→expected-behavior cases per generated agent, run before declaring the build a success.
- **Reuse / archive** — detect when a new need is close enough to an already-generated agent to reuse it rather than generate a near-duplicate; archive/prune generated agents that stop being used.
- **Same-run retry of the original task** — after a chat gap-offer writes a new agent, the user must manually re-run their task; the new agent isn't picked up mid-process. Deliberately deferred (the "no same-run activation" safety property), not a bug. (Slice 18 added a bounded same-run *regeneration* on validation failure — distinct from same-run *activation*, which stays off.)
- **OAuth-gated server suggestions** — the agent-builder only ever suggests from the palette-only, static-key-or-keyless pack entries (same posture as Slice 15's own OAuth deferral above); it doesn't gain a credential flow of its own.
- ~~**Tool-code generation**~~ — ✅ **shipped, declawed (Slice 18)**: `buildTool` (`generate-tool.ts`/`validate-tool.ts`/`write-tool.ts`) can now generate a *new* tool implementation, but only behind mandatory consent and only to an **inert `tool-proposals/<name>.proposal.ts`** — never wired into any registry/index/`mcp.json`, so there is **no same-run activation**. A `bun run` CLI entry point for it is still a future step.
- **`*.live.test.ts` for the agent-builder** — no live end-to-end pass exists yet proving generate→consent→write→next-run-works against a real Ollama model; unit tests with injected fakes cover every unit, but the full loop is unverified live.

### Slice 18 follow-ons (deferred deliberately — MUST be included in future, not dropped)

Recorded so nothing is silently lost (see the Slice-18 ledger MINORs + spec non-goals):
- **Stand up LM Studio & llama.cpp as full inference runtimes** + **live-verify the LM Studio / llama.cpp download adapters** — Slice 18 wired LM Studio's *download* adapter (contract-tested) and completed the shared HF-fetch GGUF/MLX path; inference runtimes + their live-verify remain deferred (not installed on the dev machine). (Also listed under Slice-14 follow-ons + "Alternate runtimes".)
- **Live OAuth handshake** (PKCE / browser flow / token persistence) — Slice 18 wired + contract-tested the `authProvider` seam; the real handshake is its own unit of work. (Also under Slice-15 follow-ons.)
- **GitHub remote-HTTP live-verify** (needs `GITHUB_PAT`) and **interactive consent-prompt UX live-verify** — both still outstanding (Slice-15 follow-ons).
- **`buildTool` CLI wiring** — `buildTool` exists + is unit-tested but has no `bun run` entry point yet; add one (with the same consent/inert-proposal posture) when the tool-code path graduates from "logged, reviewable" to "user-driven."
- **Retry-of-permanent-failures short-circuit** (Slice-10 MINOR) — `hf-fetch`/`ollama` `withRetry` waits the full backoff even for permanent failures (sha256 mismatch, EACCES); a `permanent` error marker to short-circuit is a candidate (mirrors Ollama's existing scope, not a regression).
- **Minor cleanups** — `MultiProgressBar` writes to stderr but is TTY-gated on `stdout.isTTY` (cosmetic if the streams diverge); `SnapshotEntry` type is duplicated between `snapshot-source.ts` and `refresh-snapshot.ts` (DRY); `tests/mcp/mount-all.test.ts` imports a mock helper from `client.test.ts` (order-fragile — extract to a shared `tests/mcp/test-helpers.ts`); `RepoShape` is a string-literal union rather than a string enum (plan-mandated internal signature).
- **Live MCP registry query** (`registry.modelcontextprotocol.io`) and **Spec-2026-07-28 / MCP TS-SDK-v2 (AI SDK v6→v7) migration** — both remain deferred (frozen API / dedicated dep-upgrade slice).
