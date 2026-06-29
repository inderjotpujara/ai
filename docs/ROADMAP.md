# Roadmap

The long-range plan for this local-first, self-owned multi-agent platform. Each
item below becomes its own **brainstorm → spec → plan → subagent-driven build**
cycle (the same flow used for Slices 1–4). Order is a recommendation driven by
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

## In progress

| Slice | Capability | Status |
|---|---|---|
| **4** | **Model Manager** — multi-model, hardware-aware: load/evict/pin within the GPU budget; orchestrator on a small pinned `qwen3.5:4b`, specialists on `qwen3.5:9b` loaded on demand | 🔨 building |

## Near-term — finish the resource-manager line

| Slice | Capability | Depends on | Notes |
|---|---|---|---|
| **5** | **Dynamic model selection** — an agent declares a *role/requirements* (`requires:['tools'], prefer:'fits-budget'`); a model **registry** + selector picks the best model that fits; the manager loads it | Slice 4 | Turns model choice from hardcoded into capability-driven |
| **6** | **Model discovery** — auto-fetch the latest models from Hugging Face, pull on demand, keep declarations current (no hardcoded list); feeds the Slice-5 registry | Slice 5 | "Always on the latest models" becomes runtime behavior |
| **4.5** | **Reclaim** — when memory is genuinely tight: degrade → ask once → kill non-essential apps (keeping a protected set) | Slice 4 | Small escalation of the manager; slot in once memory pressure is real |

## Headline next — self-extension

| Slice | Capability | Depends on | Notes |
|---|---|---|---|
| **7** | **Agent-builder** ⭐ — on `report_capability_gap`, generate a new agent definition file (+ suggest an MCP server to mount) so the system *grows a capability* on demand. The `report_capability_gap` seam is already in place. | Slices 2, 3, (5/6 help) | **Highest-leverage future feature** — makes "describe a need → the system extends itself" real |

## Orchestration & intelligence

- **Deeper agent graphs** — a "researcher" agent that itself delegates to `web_fetch` + `file_qa` (composability already exists via agents-as-tools), with the **hardware/context-aware guardrails**: delegation **depth limit** + cross-agent **cycle detection** + concise/summarized returns.
- **Parallel fan-out** — when sub-tasks are independent, run specialists **concurrently** within the memory budget the Model Manager enforces.
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

## Recommended priority after Slice 4

1. **Agent-builder (Slice 7)** — the feature that makes the self-extension vision real; the `report_capability_gap` hook is already waiting for it.
2. **Model discovery (Slice 6)** — keeps the system on the latest models automatically.
3. **Run-viewer UI** — makes the whole system visible and demoable for the cost of reading JSONL we already write.

(Slices 5 → 6 are the natural continuation of the resource line currently being built; the agent-builder can also be pulled forward if it's the exciting one.)

## Deferred technical items (cross-cutting, fold in opportunistically)

- Declarative **`mcp.json` mount registry** (list servers + which agents get them, loaded at startup) — generalizes Slice 3's in-code mounts.
- **Codex** heavy-lifting backup (`@openai/codex-sdk`, personal plan) as an opt-in delegate agent.
- Migrate `biome.json` off the deprecated `recommended` field.
- **Per-slice Minor review findings** are recorded in `.superpowers/sdd/progress.md` (the SDD ledger) as each slice completes — e.g. run-journal O(n²) append, `runAgent.providerOptions` cross-package type, gap `message` hardcoded English, `ensureReady` post-pull comment, hardcoded `kvBytesPerToken`. Sweep them opportunistically; none are blocking.
- **Hardware/context-aware guardrails for deeper composition** (recorded constraint): the agent-graph/parallel-fan-out slices MUST bound delegation depth, add cross-agent cycle detection, reuse warm models (shared-model agents = one resident copy), keep returned answers concise, and schedule concurrency within the Model Manager's budget. Cost compounds ~15× for naive orchestrator-workers, so depth/fan-out are bounded deliberately.
