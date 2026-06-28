# agents/

**All agents live here, in the repo.** Each agent is a small, self-describing
definition: a model reference (or capability/role), a system prompt, and the
set of tools it may use. New agents are added by dropping a new file here — the
engine does not change.

An agent is just a configured run of the shared loop in
[`src/core/agent.ts`](../src/core/agent.ts) (`runAgent`). The future
**super-agent / orchestrator** will itself be an agent whose tools delegate to
the other agents in this folder ("agents-as-tools").

## Status (Slice 1)

The first agent — a **local file Q&A / summarizer** — is currently wired
directly in [`src/cli/answer-file-question.ts`](../src/cli/answer-file-question.ts)
to keep the first slice small. As more agents arrive (Slice 2+), each gets its
own declaration file in this folder and the orchestrator composes them.

See [`docs/architecture.md`](../docs/architecture.md) for how agents, models,
tools, and the resource manager fit together.
