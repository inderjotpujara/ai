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
> composition guardrails (Slice 9), workflow/DAG engine (Slice 10), and crews &
> roles (Slice 11) have landed. Remaining Phase B work (memory/RAG, grounded
> verification) → integration library → agent-builder → triggers is next. See
> [`docs/ROADMAP.md`](docs/ROADMAP.md).

> **Status:** Slice 11 complete — **crews & roles**. `defineCrew()` +
> `bun run crew <name>` compose role/goal/backstory members and dependent tasks
> into a **sequential** (compiled to a Slice-10 workflow DAG) or **hierarchical**
> (orchestrator + auto manager) process, with live largest-that-fits model
> selection now wired into both the `flow` and `crew` CLIs. Also shipped: Slice 8
> (OTel run-viewer, `bun run runs`), Slice 9 (composition guardrails —
> delegation depth limit + return-size cap), and Slice 10 (workflow/DAG engine,
> `bun run flow <name>`). See [Roadmap](#roadmap).

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
| `src/core/` | `agent.ts` (the loop), `agent-def.ts`, `delegate.ts`, `orchestrator.ts`, `capability-gap.ts`, `resource-capture.ts` (the `{kind:'resource'}` seam), `types.ts`, `errors.ts` |
| `src/providers/` | `ollama.ts` — builds an AI SDK model from a declaration |
| `src/resource/` | `hardware.ts` (live free-RAM via `vm_stat` + Metal-cap ceiling), `footprint.ts` (weights + KV split), `kv-cache.ts` (per-model arch-derived KV sizing + quant-risk), `model-manager.ts` (load/evict/pin + dynamic `num_ctx`), `model-store.ts` (installed-model cache), `selector.ts` (capability filter + largest-that-fits + `resolveModel` fallback loop), `ollama-control.ts` (pull/warm/unload/`getModelMaxContext`/`getModelKvArch`) |
| `src/runtime/` | `runtime.ts` (runtime port), `ollama.ts` + `mlx-server.ts` (adapters), `registry.ts` (runtime registry) — build a model from a declaration per provider |
| `src/discovery/` | `discover.ts` + `build-registry.ts` (offline registry merge), `catalog-source.ts` + `huggingface-gguf.ts` + `huggingface-mlx.ts` + `hf-client.ts` (HF catalogs), `host.ts` (machine detect), `catalog-cache.ts`, `quant.ts`, `sources.ts` |
| `src/run/` | `run-store.ts` (run dirs + artifacts), `journal.ts` (resumable JSONL log) |
| `src/tools/` | `read-file.ts` — the `read_file` tool |
| `src/mcp/` | `server.ts` (exposes tools over MCP), `client.ts` (consumes them) |
| `src/cli/` | `chat.ts` (entrypoint), `run-chat.ts` (testable orchestration), `select-hook.ts` (selector-driven `onBeforeDelegate`), `selection-notice.ts` (per-delegation notice) |
| `models/` | model **declarations** (data, not weights) — `qwen-fast.ts`, `qwen-router.ts`, `registry.ts` (bootstrap capability ladder) |
| `agents/` | agent definitions — **all agents live here** ([readme](agents/README.md)) |
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
`LanguageModel`). Ollama is just the default Tier-1 adapter. If we ever need
lower-level control (custom sampling, persistent KV-cache), we can add a raw
**llama.cpp-server** or **MLX-server** (omlx/vMLX) adapter behind the same
interface — no agent code changes. See
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
| **Next (product line)** | Toward a local **n8n × CrewAI**, continuing Phase B: **memory/RAG** → **grounded verification** → **C** connect (`mcp.json` mount registry · integration pack) → **D** grow (**agent-builder ⭐**) → **E** automate (triggers · daemon) → **F** breadth on-demand (vision · audio · video · uncensored · voice · UI) | Planned |

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
