# Local Agents

A **local-first, multi-agent framework** for Apple Silicon. Build and run AI
agents against **local models** (no API keys), orchestrated by a super-agent,
on your own machine — today on a laptop, soon full-throttle on a dedicated Mac
Mini.

> **Status:** Slice 2 complete — a generic **orchestrator (super-agent)** routes
> your request to a matching sub-agent (currently file-Q&A) via agents-as-tools,
> or clearly reports a capability gap ("I don't have a capability for X yet")
> instead of guessing. Built on Slice 1's local-model + MCP-tool foundation. See
> [Roadmap](#roadmap).

---

## What it does (today)

```sh
# Ask a question about a local file. The agent reads the file via a tool and answers.
bun run src/cli/chat.ts "What animal is mentioned in /tmp/sample.txt?"
```

Under the hood, one CLI run autonomously:

1. **Checks the memory budget** — estimates the model's footprint and confirms
   it fits the machine's GPU-usable memory (~75% of unified RAM).
2. **Ensures the model is present** — pulls `qwen3:8b` if it isn't installed
   (no hardcoded download step you have to run).
3. **Warms the model** into memory.
4. **Runs the agent loop** — the model calls a `read_file` tool (exposed over
   **MCP**) and composes an answer.
5. **Records the run** — writes the answer and an append-only journal to
   `runs/<id>/`.
6. **Unloads the model** to free memory.

No manual steps. No API keys. Everything runs locally.

---

## Quick start

**Prerequisites:** [Bun](https://bun.com) ≥ 1.3, [Ollama](https://ollama.com)
(running locally), an Apple Silicon Mac.

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
# Real end-to-end (downloads qwen3:8b on first run):
echo "The quick brown fox jumps over the lazy dog." > /tmp/sample.txt
bun run src/cli/chat.ts "What animal is in /tmp/sample.txt?"
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
| `src/core/` | `agent.ts` (the loop), `types.ts`, `errors.ts` |
| `src/providers/` | `ollama.ts` — builds an AI SDK model from a declaration |
| `src/resource/` | `hardware.ts` (budget), `footprint.ts` (RAM estimate), `ollama-control.ts` (pull/warm/unload) |
| `src/run/` | `run-store.ts` (run dirs + artifacts), `journal.ts` (resumable JSONL log) |
| `src/tools/` | `read-file.ts` — the `read_file` tool |
| `src/mcp/` | `server.ts` (exposes tools over MCP), `client.ts` (consumes them) |
| `src/cli/` | `chat.ts` (entrypoint), `answer-file-question.ts` (testable orchestration) |
| `models/` | model **declarations** (data, not weights) — e.g. `qwen-fast.ts` |
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
| **3** | Full resource manager (multi-model scheduling, dynamic selection) + **model discovery** (auto-fetch latest models per machine, no hardcoded list) | Planned |
| **Later** | Codex backup · resumable long/multimodal jobs (e.g. book→audiobook) · LM Studio / MLX-server adapters · streaming CLI | Planned |

Design specs and implementation plans live in
[`docs/superpowers/`](docs/superpowers/).

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
