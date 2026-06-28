# Local-First Multi-Agent Framework — Design

**Date:** 2026-06-28
**Status:** Approved (design) — pending implementation plan
**Stack:** TypeScript + Bun + **Vercel AI SDK 6** (engine base)
**Dev hardware (verified):** Apple **M4 Pro, 24 GB** unified memory, 16 GPU cores. Future: dedicated **Mac Mini** as always-on inference box.
**Methodology validated against:** mid-2026 (June 2026) state of the art — see §12.

## 1. Vision

A growing, **local-first** multi-agent system, built incrementally on this Mac and intended to run
full-throttle on the Mac Mini. A **super-agent (supervisor)** talks to the user and delegates to
specialized **sub-agents**, added over time. Everything runs against **local AI models** by default —
no hosted-API keys, because paid APIs defeat the purpose of owning the Mac Mini.

A single cloud backup — **Codex** (`@openai/codex-sdk`, personal ChatGPT plan) — is an **opt-in
"heavy-lifting" escape hatch** the system may invoke per run when a local model isn't enough.

**Explicitly excluded:** Claude Code; Gemini CLI (subscription/OAuth automation risks bans —
enforced Mar 2026); all hosted model API keys.

## 2. Design principles

- **Autonomous — the user is never required to take manual steps.** The system (super-agent,
  sub-agents, resource manager) takes actions itself: choosing a model, loading/unloading, sequencing
  work, resuming runs. It never blocks waiting on the user.
- **Degrade first, then ask to reclaim.** When resources are tight it self-adapts **first** (pick a
  smaller model that fits, sequence tasks). If that's still not enough, it **asks the user once** —
  presenting the specific memory-hungry processes — and on approval **kills all of them except the
  ones it needs** (itself, the model runtime/Ollama, and OS-critical processes are a protected set).
  After approval it acts autonomously; killing is never silent/unprompted (it's destructive →
  confirm-before-destructive gate).
- **Local-first, no keys.** Ollama by default; cloud only as opt-in Codex backup.
- **Model freshness is a runtime behavior, not a code change.** The system **discovers the latest
  available models at runtime** (multi-source, Hugging Face primary) and picks/pulls the best that
  fits this machine. No hardcoded model list in logic — getting newer models never requires editing
  code (§7.5). Model declarations are *data* (a pinned name or, better, a capability/role the
  discovery layer resolves).
- **Small, modular, plain code.** One responsibility per file, loose coupling, self-explanatory code —
  no dense "clever" code. If a file grows large, it's doing too much; split it.
- **YAGNI / phased.** Build the smallest useful slice end-to-end, then grow (§11).

## 3. Architecture

**Engine base — Vercel AI SDK 6.** Provides the provider-agnostic `LanguageModel` interface (the
"port"), Zod-typed tools, the tool-calling loop with `stopWhen: stepCountIs(N)` guards, parallel tool
calls, structured outputs, an MCP client, and a mock model for tests. **We write only** the thin
layer on top: agents, the supervisor (slice 2), model declarations, MCP tools, the resource manager,
and the run store.

**Pattern — Supervisor / agents-as-tools** (slice 2+). Delegation is a tool call; a sub-agent is
wrapped as a `delegate_to_<name>(task)` tool on the supervisor. Same loop, no second engine.

### 3.1 Folder layout (small single-responsibility files)
```
src/
  core/
    types.ts          # shared types: AgentConfig, ModelDeclaration, ModelRef, RunResult
    errors.ts         # typed errors: ProviderError, ToolError, MaxStepsError, ResourceError
    agent.ts          # Agent: wraps AI SDK 6 loop (generateText + tools + stopWhen)
    # slice 2+: orchestrator.ts (supervisor), delegate.ts (agent-as-tool wrapper)
  providers/
    ollama.ts         # Tier 1: Ollama-backed LanguageModel via `ai-sdk-ollama`
    # later: codex.ts (Tier 2, @openai/codex-sdk as delegate agent)
  resource/           # Resource & Model Manager — autonomous, hardware-aware (§7)
    hardware.ts       # detect chip / total RAM / GPU budget (sysctl, ioreg, vm_stat, memory_pressure)
    footprint.ts      # estimate a model's RAM need (weights + KV-cache) before loading
    ollama-control.ts # warm/preload, keep_alive pin, unload, GET /api/ps inspection
    # slice 3: scheduler.ts (concurrent-vs-sequential plan), selector.ts (dynamic model pick),
    #          reclaim.ts (list memory hogs, ask once, kill all but the protected set)
  discovery/          # Model Discovery — multi-source, no hardcoded list (§7.5)
    catalog-source.ts # CatalogSource port: listCandidates(query) -> Candidate[]
    huggingface.ts    # PRIMARY source: HF Hub API (GGUF + MLX), file sizes, gguf metadata
    ollama-local.ts   # GET /api/tags — what's already installed (skip/enrich)
    candidate.ts      # Candidate type + dedupe (normalize base-model identity across orgs)
    tool-capability.ts# detect tool support by parsing gguf.chat_template for tool_call tokens
    ranker.ts         # score by fits-budget + tool-capable + recency/downloads (+ BFCL if matched)
    puller.ts         # pull on demand: `ollama pull hf.co/{repo}:{quant}`
    # optional later: ollamadb.ts (unofficial enrichment), lmstudio.ts, mlx-source.ts
  run/                # file-based run store — state without a DB (§6)
    run-store.ts      # create runs/<run-id>/, stream artifacts to disk
    journal.ts        # append-only JSONL step journal (resumable long jobs)
  mcp/
    server.ts         # exposes tools/ over MCP
models/               # USER model declarations (provider + name + params + role + resource tags)
  qwen-fast.ts        # qwen3:8b — general reasoning + tool use
agents/               # USER agent definitions (model ref + system prompt + tools)
  file-qa.ts          # slice-1 agent: local file Q&A / summarizer
tools/
  read-file.ts        # slice-1 tool: read_file (read-only), surfaced via MCP
cli/
  chat.ts             # runnable example: talk to the file-qa agent
tests/
```
`models/` holds small, git-friendly **declarations**, not weights (weights live in `~/.ollama`).

### 3.2 Core abstractions (the units)

- **Model layer** — AI SDK 6's `LanguageModel`. `src/providers/ollama.ts` is a thin factory producing
  an Ollama-backed model via `ai-sdk-ollama` (more reliable tool-calling than the OpenAI-compat shim).
- **`ModelDeclaration`** (`models/*.ts`) — *data, not logic.* Two forms, both resolved at runtime to
  a `LanguageModel`:
  - **Pinned:** `{ provider: ProviderKind, model: 'qwen3:8b', params, role }` (simple; slice 1).
  - **Resolved (slice 3):** `{ role, requires: ['tools'], prefer: 'newest-that-fits', params }` — the
    discovery + selector layers pick the best *current* model that fits the budget. No model name in
    source, so new models are adopted with zero code change.
  `provider` is a **string enum** (per CLAUDE.md).
- **`Tool`** (`tools/*.ts`) — Zod-typed `{ name, description, parameters, execute }`, surfaced over
  **MCP** via `src/mcp/server.ts`; the agent loop consumes them through AI SDK 6's MCP client.
- **`Agent`** (`src/core/agent.ts`) — `{ name, model: ModelRef, systemPrompt, tools }`; `run(input)`
  calls the AI SDK loop with a `stopWhen: stepCountIs(N)` guard; tool errors are returned to the model
  so it can self-correct; independent tool calls run in parallel.
- **`Orchestrator`** (slice 2) — an `Agent` whose tools are sub-agents wrapped via `delegate.ts`.

## 4. Data flow (slice 1)
```
CLI (chat.ts)
  -> ResourceManager: detect budget -> ensure qwen3:8b fits -> warm it (preload)
  -> Agent("file-qa").run(userMessage)         [AI SDK loop, stepCountIs guard]
       -> model decides: call read_file(path)  [MCP tool]
       -> tool result appended; model composes answer
  -> RunStore: write answer + journal to runs/<id>/
  -> ResourceManager: unload model if policy says so
  -> CLI prints answer
```
Slice 2 inserts the supervisor delegating to `file-qa` (and future agents).

## 5. Error handling
Typed errors: `ProviderError`, `ToolError`, `MaxStepsError`, `ResourceError` (later: `DelegationError`).
- **Tool failures are returned to the model** as tool results, not thrown.
- The loop's **`stopWhen: stepCountIs(N)`** guard prevents infinite tool loops.
- `ResourceError` only when a model genuinely cannot fit the budget *and* no smaller model qualifies —
  the manager tries to degrade first (§7).

## 6. State without a database — file-based run store
- Each run gets **`runs/<run-id>/`**. Large/intermediate data **streams to disk as artifacts**
  (extracted text, audio chunks, partial transcripts) instead of living in RAM → memory stays bounded
  for long multimodal jobs (e.g. book→audiobook).
- **`journal.ts`** appends a JSONL line per step (input, tool calls, artifact paths, status) →
  long/crashed runs are **resumable** by replaying the journal. No DB.
- `run/` stays two tiny files (`run-store.ts`, `journal.ts`); persistence backend can be swapped later
  without touching agents.

## 7. Resource & Model Manager (autonomous, hardware-aware)
The component that makes "local" practical. **It acts on its own (principle §2); it never asks the
user to do things.**

- **`hardware.ts`** — detects chip (`sysctl machdep.cpu.brand_string`), total RAM (`os.totalmem`),
  GPU cores (`ioreg -r -c AGXAccelerator`), and the real inference ceiling: the **Metal GPU wired
  limit ≈ 75% of unified memory (~18 GB on this 24 GB machine)**. Reads live availability via
  `vm_stat` (page size **16384** on Apple Silicon — not 4096) and `memory_pressure`; **does not** rely
  on `os.freemem()` (unreliable on macOS, differs Bun vs Node).
- **`footprint.ts`** — estimates a model's RAM before loading: `weights ≈ params × bpw × 1.2`
  (Q4_K_M ≈ 0.56 B/param) `+ KV-cache` (∝ `num_ctx × num_kv_heads × head_dim × layers`; use GQA
  `num_kv_heads`). Confirms actuals post-load via `/api/ps` (`size`, `size_vram`).
- **`ollama-control.ts`** — warm/preload (empty-prompt `POST /api/generate {"model":X}`), pin
  (`keep_alive:-1`), unload now (`keep_alive:0` or `ollama stop X`), inspect (`GET /api/ps`).
- **`scheduler.ts`** (slice 3) — if all needed models fit the budget → load concurrently
  (`OLLAMA_MAX_LOADED_MODELS`); else **load → run → unload → next**, automatically.
- **`selector.ts`** (slice 3) — model registry tagged with capability + estimated footprint; filters
  by the live budget and picks the **highest-capability model that fits**; can swap in newer models.
- **`reclaim.ts`** (slice 3) — escalation when degrading isn't enough: enumerate top memory consumers
  (`ps -axro pid,rss,%mem,comm -m`), **ask the user once** with the list, and on approval kill all of
  them **except the protected set** (this process, Ollama/the model runtime, OS-critical processes),
  then re-measure and proceed. Never kills unprompted.

**Slice 1 uses only the minimal trio** (`hardware`, `footprint`, `ollama-control`): confirm one model
fits, warm it, unload at end. Scheduler/selector arrive in slice 3.

## 7.5 Model Discovery (multi-source, no hardcoded list)
Lets the system **fetch the latest models per machine without code changes**. Pluggable
`CatalogSource` port (same ports-and-adapters move as the runtime layer), with **Hugging Face as the
primary source** — the only mid-2026 catalog that is official, unauthenticated-readable, covers GGUF
*and* MLX, and exposes file sizes + tool-capability signal.

Pipeline (`src/discovery/`):
1. **Fetch candidates** (parallel sources) — HF Hub API:
   `GET /api/models?filter=gguf&pipeline_tag=text-generation&sort=lastModified&direction=-1&expand[]=gguf&expand[]=downloads&expand[]=tags`
   (add `library=mlx` only when an MLX runner is viable, i.e. >32 GB — the Mac Mini, not this 18 GB
   box). Enrich with local `GET /api/tags` (already-installed) and optionally ollamadb (unofficial).
2. **Dedupe** — normalize on base-model identity (strip quant suffix / org prefix; prefer canonical
   or most-downloaded repo when the same weights appear across orgs).
3. **RAM filter** — per candidate, read exact quant **file sizes** (`GET /api/models/{repo}?blobs=true`
   or `/tree/main?recursive=true`); pick the largest quant whose size ≤ budget
   (`§7` GPU budget − KV-cache estimate). Quant preference: `Q4_K_M` → `UD-Q4_K_XL`/`IQ4_XS` → `Q5_K_M`.
4. **Tool-capability filter** — require `gguf.chat_template` to contain tool tokens (`tool_call`,
   `tools`); the most reliable signal (tags are inconsistent). Drop non-tool-capable candidates.
5. **Rank** — weighted: fits-budget + tool-capable + recency/downloads (+ BFCL-V4 score if the name
   matches the leaderboard).
6. **Pull on demand** — `ollama pull hf.co/{repo}:{quant}` (GGUF on Apple Silicon ≤18 GB). MLX path
   (`mlx-community` repos) reserved for the >32 GB Mac Mini.

Results are cached (respect HF rate limits; an optional API token is treated as non-secret config kept
out of source). HF is source-of-truth; Ollama-local / ollamadb / LM Studio are enrichment only.

## 8. Testing strategy
- **TDD** against **AI SDK 6's mock language model** — full agent loop + tool calls tested in memory,
  **zero models running**.
- `resource/` units tested by mocking the shell/HTTP calls (deterministic `vm_stat`/`api/ps` fixtures).
- Real-Ollama tests are **separate and opt-in**, skipped when Ollama isn't reachable.
- Run via `bun run test` (single: `-t "name"`; file glob: `bun run test:file`).

## 9. Apple Silicon optimization
- **Ollama is the default and already MLX-accelerated** on 32GB+ Apple Silicon (0.19+, Mar 2026);
  below 32 GB it falls back to llama.cpp Metal (this 24 GB machine → Metal fallback; works fine).
- **Quantization:** prefer Unsloth dynamic **`UD-Q4_K_XL`** over plain `Q4_K_M` for agent/coding
  reliability on Qwen3.x.
- **Recommended models (mid-2026), strong at tool-calling:** `qwen3:8b` (~5–6 GB) default;
  `qwen3:14b` (~10 GB) when quality matters; `qwen3-coder` for coding; `qwen3:4b` for low-RAM/fast;
  `llama4:scout` for long-context on 32 GB+.
- **Caveat:** Ollama's `format` structured-output ≠ OpenAI `json_schema`; validate with Zod our side.

## 10. Provider tiers
- **Tier 1 (default, local, no keys):** Ollama. Room for LM Studio / dedicated MLX server (omlx/vMLX)
  later behind the same `LanguageModel` interface, if heavy loops need persistent KV-cache/concurrency.
- **Tier 2 (opt-in backup):** Codex via `@openai/codex-sdk` (personal plan), modeled as a delegate
  agent, invoked per run. No keys; personal-use only.

## 11. Build phases
- **Slice 1 (first):** ONE basic agent — **local file Q&A / summarizer**. Flow: budget check → ensure
  the declared model is present (**pull if missing**, no hardcoded list in logic) → warm it → AI SDK
  loop with the **`read_file` MCP tool** → write answer + journal to a run dir → unload. Tested with
  the mock model. `bun run typecheck` + `bun run lint` clean. *No supervisor, no multi-model, no
  discovery layer, no Codex* (uses a pinned declaration for simplicity).
- **Slice 2:** supervisor (agents-as-tools) + a second sub-agent; CLI talks to the super-agent.
- **Slice 3:** full Resource & Model Manager + **Model Discovery** — `scheduler`
  (concurrent-vs-sequential), `selector` (dynamic choice by budget/capability), and `discovery/`
  (multi-source HF-primary fetch of latest models, resolved declarations, pull-on-demand). This is
  where "fetch latest models, no code changes" becomes fully automatic.
- **Later:** Codex backup; resumable long/multimodal jobs (book→audiobook) on the run store; LM
  Studio/MLX-server adapters; streaming CLI; optional A2A interop.

## 12. Methodology validation (mid-2026 sources)
Checked 2026-06-28 against current practice:
- **Engine:** Vercel AI SDK 6 (stable Dec 2025) is the de-facto TS base; hand-rolling reinvents it.
- **Pattern:** agents-as-tools / supervisor still the recommended default (Anthropic *Building
  Effective Agents*; ~15× token cost → bound fan-out).
- **Tools:** MCP has won the agent↔tool layer (Linux Foundation governance).
- **Runtime:** Ollama 0.19+ MLX-accelerated on 32GB+; warm-up/keep_alive/`/api/ps` APIs verified.
- **Hardware facts verified on-device:** GPU budget ≈ 75% RAM; page size 16384; `os.freemem()`
  unreliable on macOS; footprint = weights(×1.2) + KV-cache(GQA).
- **Models:** Qwen3 / Qwen3-Coder lead local tool-calling; UD-Q4_K_XL quant preferred.
- **Discovery:** no official Ollama catalog API; **Hugging Face Hub API** is the primary data-driven
  source (GGUF + MLX, file sizes via `?blobs=true`/`/tree`, tool-capability via `gguf.chat_template`).
  Composes with `ollama pull hf.co/{repo}:{quant}`. BFCL-V4 = quality signal (no live ranking API).
  Catalog freshness is runtime-fetched, never hardcoded.
- **Backups:** Codex has an official TS SDK; Gemini CLI subscription automation risks bans (excluded).
