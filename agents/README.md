# agents/

**All agents live here, in the repo.** Each agent is a small, self-describing
definition: a model **capability requirement** (`modelReq`: `requires` / `prefer`),
a system prompt, and the set of tools it may use. New agents are added by dropping
a new file here — the engine does not change.

An agent is just a configured run of the shared loop in
[`src/core/agent.ts`](../src/core/agent.ts) (`runAgent`). The orchestrator
(`agents/super.ts`) is itself an agent whose tools delegate to the other agents
in this folder ("agents-as-tools").

## Current agents

| File | Role |
|---|---|
| `file-qa.ts` | Local file Q&A / summarizer — uses the `read_file` MCP tool |
| `web-fetch.ts` | Web fetcher — uses `uvx mcp-server-fetch` (keyless) |
| `super.ts` | Orchestrator — routes to `file-qa` and `web-fetch` as tools; falls back to `report_capability_gap` |

Since Slice 5, an agent declares a **capability requirement** (`modelReq`:
`requires: [Capability.Tools]`, `prefer: PreferPolicy.LargestThatFits`) instead of
a fixed model. At each delegation the selector (`src/resource/selector.ts`) picks
the largest model in `models/registry.ts` (e.g. `qwen-router.ts` 4b, `qwen-fast.ts`
9b) that fits the live budget, and the chosen model binds lazily. The chosen
declaration's `params.numCtx` is the **desired** context window; the Model Manager
scales it down dynamically to fit live free-RAM headroom — `chosenCtx =
min(desired, modelMax, headroom-fit)`, floored at 4096. No agent definition
hard-codes a model name, a context size, or a budget value.

See [`docs/architecture.md`](../docs/architecture.md) for how agents, models,
tools, and the resource manager fit together.
