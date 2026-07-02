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
model/resource management). Six more (Slices 8–13) have since landed the
first wave of the **product** pivot: an OTel run-viewer, composition
guardrails, a deterministic workflow/DAG engine, a crews & roles layer
composed on top of it, a persistent semantic memory layer (LanceDB +
`bun:sqlite`, optional cross-encoder rerank) crews/workflows can opt into, and
a grounded-verification layer (claim decomposition, a MiniCheck faithfulness
judge, bounded Corrective RAG, abstention) that opts a crew/workflow run into
citation-checked, hallucination-resistant answers via `--verify`. The
**product surface** is still thin beyond that: 3 agents (`super`, `file-qa`,
`web-fetch`), 1 native tool (`read_file`) + 1 mounted MCP server
(`mcp-server-fetch`) — first-boot model provisioning ships in Slice 14
(Ollama live-verified; LM Studio/llama.cpp/MLX contract-tested, live-verify
deferred).

| n8n / CrewAI concept | Our analog | Status |
|---|---|---|
| AI-agent node (model + prompt + tools + loop) | `Agent` (`src/core/agent.ts`) | ✅ built |
| Hierarchical process / supervisor | orchestrator (agents-as-tools) | ✅ built |
| Self-hosted, your infrastructure | local-first, Ollama, Mac Mini | ✅ core premise |
| Hardware-aware scheduling | Model Manager (live RAM budget, KV quant) | ✅ built (Slices 4–7) |
| Integration library (n8n's 400+ nodes) | mounted MCP servers | 🟡 1 server — needs a **mount registry + pack** |
| **Workflow / DAG (deterministic steps)** | **workflow engine** | ✅ **built (Slice 10)** |
| **Crew (role + goal + task + process)** | crews / roles / tasks | ✅ built (Slice 11) |
| Structured data between steps | response-format / typed I/O | ✅ built (Slice 10 — Zod-validated step I/O) |
| Execution view / run history | run-viewer | ✅ built (Slice 8 — OTel trace + `bun run runs`) |
| Triggers (webhook / schedule / event) | scheduled & triggered agents | ❌ not built |
| Create-a-node / create-an-agent | **agent-builder ⭐** | ❌ not built (seam in place) |
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

> **Slice 14 lays the download half of these.** Slice 14 ships a runtime-agnostic
> `DownloadProvider` + `CatalogSource` for **all four** runtimes (Ollama, LM Studio,
> llama.cpp, MLX). What remains for LM Studio & llama.cpp — **explicitly deferred, must
> be included in future** — is (a) standing them up as full **`ProviderKind` inference
> runtimes** (chat/completions wiring behind the AI SDK `LanguageModel` interface, not
> just download), and (b) **live-verifying their download adapters** once installed on a
> test machine (Slice 14 verifies Ollama live; the other three ship contract-tested with
> live-verify logged-deferred).

- **Dedicated MLX-server / LM Studio adapters** — behind the same AI SDK `LanguageModel` interface: persistent KV-cache (omlx) or high concurrency (vMLX) for heavy agent loops when Ollama's sequential serving isn't enough. *(Download side lands in Slice 14; inference wiring + live-verify deferred — see note above.)*
- **Raw `llama.cpp`-server adapter** — low-level control (custom sampling/flags) if ever needed; Ollama stays the default. *(Download side lands in Slice 14; inference wiring + live-verify deferred.)*
- **Bigger models on the Mac Mini** — >32 GB unified memory hosts larger specialists (`qwen3.5:14b+`, `llama4:scout` long-context); the Model Manager already budgets to the host, so it's mostly a declaration change.

---

## ⭐ Recommended sequence (critical path to n8n × CrewAI)

1. ✅ **Run-viewer** (Phase A) — shipped, Slice 8. See the engine work; the cheapest high-value slice and the debugging surface everything later needs.
2. ✅ **Composition guardrails** (Phase B) — shipped, Slice 9. Small, unblocks safe multi-agent depth.
3. ✅ **Workflow / DAG engine** (Phase B) — shipped, Slice 10. The defining n8n/CrewAI capability we lacked.
4. ✅ **Crews & roles** (Phase B) — shipped, Slice 11. The CrewAI role/task/process layer, composed on the workflow engine + orchestrator.
5. ✅ **Memory / RAG** (Phase B) — shipped, Slice 12. Persistent semantic memory (LanceDB + `bun:sqlite`, weights-only embedder via the Model Manager, dense retrieval + optional default-on cross-encoder rerank) that crews/workflows can opt into via a `recall` tool + auto-persist.
6. ✅ **Grounded verification** (Phase B) — shipped, Slice 13. Closes the retrieve-then-hallucinate loop Slice 12 opened: claim decomposition, cited-evidence lookup, a MiniCheck faithfulness judge (consent-pull + fallback), bounded Corrective RAG, and an explicit abstain outcome, opt-in via `--verify`.
7. ✅ **shipped, Slice 14** — **First-boot model provisioning + runtime-agnostic downloader**. A fresh clone/machine used to need manual `ollama pull`s for the router, specialists, embedder, and the verification judge (`bespoke-minicheck`); `bun run provision` (plus a non-invasive `chat.ts` auto-detect hook) now runs a guided flow (detect hardware → discover fitting models → per-model consent → download with a **live progress UI** [bytes/%/speed/ETA] → hand off to `ensureReady` on the next normal run), removing that friction. Built **runtime-agnostic** behind a `DownloadProvider` abstraction + unified progress protocol covering **all four runtimes** (Ollama + LM Studio delegating; llama.cpp + MLX via one shared HuggingFace fetcher). Discovery is **dynamic per-runtime query with a committed-snapshot fallback** (Ollama registry-manifest sizes; HF tree sizes; LM Studio SDK). Also removes the root cause of the Slice-13 selector crash (declaring models without guaranteeing install). **Live-verified on Ollama** (only runtime installed on the dev machine); **LM Studio / llama.cpp / MLX adapters ship contract-tested with live-verify explicitly deferred + logged** (see Deferred items below) — never a silent skip; the HF-fetch adapter is additionally shape-complete but not yet disk-persisting (no `.part`+rename, placeholder SHA256), a gap folded into the same deferred live-verify pass. Spec: `docs/superpowers/specs/2026-07-01-slice-14-provisioning-design.md`.
8. **`mcp.json` mount registry + starter pack** (Phase C) — make it genuinely useful; gives workflows things to *do* and agent-builder servers to *suggest*.
9. **Agent-builder** ⭐ (Phase D) — the self-extension headline; now safe (guardrails) and useful (integration library).
10. **Triggers / daemon** (Phase E) — turn workflows into automations (n8n's identity).

Reliability (graceful degradation, telemetry/eval) folds into Phase A alongside
the run-viewer. Modalities & memory (Phase F) come in on demand — not before the
product core exists.

---

## Deferred technical items (cross-cutting, fold in opportunistically)

- Migrate `biome.json` off the deprecated `recommended` field.
- **Per-slice Minor review findings** are recorded in `.superpowers/sdd/progress.md` (the SDD ledger) as each slice completes — e.g. run-journal O(n²) append, `runAgent.providerOptions` cross-package type, gap `message` hardcoded English. Sweep opportunistically; none blocking.
- **Hardware/context-aware guardrails for deeper composition** (recorded constraint): the workflow/crew/fan-out slices MUST bound delegation depth, add cross-agent cycle detection, reuse warm models (shared-model agents = one resident copy), keep returned answers concise, and schedule concurrency within the Model Manager's budget. Cost compounds ~15× for naive orchestrator-workers — depth/fan-out are bounded deliberately.

### Slice 14 follow-ons (deferred deliberately — MUST be included in future, not dropped)

Recorded so nothing is silently lost (see the Slice-14 spec §13 + `provisioning-runtime-agnostic` memory):
- **Live-verify the LM Studio / llama.cpp / MLX download adapters** once each runtime is installed on a test machine (Slice 14 verifies only Ollama live; the other three ship contract-tested with live-verify logged-deferred). This is a standing obligation, not optional.
- **HF-fetch disk persistence + real SHA256** (`src/provisioning/providers/hf-fetch.ts`) — more specific and more severe than the general live-verify gap above: the adapter today streams the HTTP response and reports Resolving→Downloading→Verifying→Done, but it **reads and discards the bytes** (no `.part` file, no atomic rename) and the `Verifying` phase's SHA256 check is a no-op placeholder unless a caller injects a hash function (and even then, over a path that generally doesn't exist). A live-verify pass for llama.cpp/MLX would fail outright today, not just be unverified — implement the actual write-to-disk + rename + real hash before attempting that live-verify pass.
- **Stand up LM Studio & llama.cpp as full `ProviderKind` inference runtimes** (chat/completions wiring, not just download) — see "Alternate runtimes" above.
- **Wire `createLmStudioProvider` into `registry.ts`'s `providerFor`** — it exists and is contract-tested but is not currently reachable from `runProvision` (LM Studio shares `ProviderKind.MlxServer` with the HF-fetch adapter, and `providerFor(MlxServer)` resolves to HF-fetch today); decide the real routing once LM Studio is installed for live-verify.
- **`gpustack/gguf-parser-go`** for remote-header size + VRAM estimate across backends — deferred (Go binary; HF-tree + Ollama-manifest sizes + `footprint.ts` VRAM suffice for now).
- **Snapshot-catalog refresh automation** — periodic job regenerating the committed snapshot from live APIs (manual/scripted refresh until then).
- **Parallel multi-model downloads** (multi-bar) — Slice 14 ships sequential-with-one-bar.
- **Live Metal `recommendedMaxWorkingSetSize` read** instead of the tier-fraction heuristic; and bumping bootstrap `bytesPerWeight` 0.56 → ~0.6 for Q4_K_M realism (fold in with fit-tuning).
