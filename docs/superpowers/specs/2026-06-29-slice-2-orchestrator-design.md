# Slice 2: Super-Agent / Orchestrator — Design

**Date:** 2026-06-29
**Status:** Approved (design) — pending implementation plan
**Builds on:** Slice 1 (file-Q&A agent, `runAgent` loop, MCP `read_file`, run store). Repo: `inderjotpujara/ai`.

## 1. Vision

A **generic super-agent (orchestrator)**: the user can ask anything. If a registered sub-agent's
capability matches the request, the orchestrator **delegates** to it (agents-as-tools). If **nothing
matches**, it must clearly **report a capability gap** ("I don't have a capability to *X* yet") and
**not attempt or hallucinate** the task. The orchestrator is itself an agent with its **own model**
(its reasoning brain) that interprets the user's intent precisely before routing.

## 2. Scope

### In scope (Slice 2)
- An `Agent` abstraction (reusable definition) — the orchestrator and sub-agents share it.
- **Agents-as-tools** delegation: each sub-agent is exposed to the orchestrator as a
  `delegate_to_<name>(task)` tool. Routing = the orchestrator model's tool selection (no new engine).
- **Capability-gap handling** via a first-class `report_capability_gap(missingCapability)` tool — the
  deterministic seam the future agent-builder will hook into.
- Refactor today's inline file-Q&A into a proper `Agent` definition in `agents/`.
- Orchestrator has **its own model declaration** + a routing system prompt that emphasizes precise
  intent understanding.
- CLI talks to the orchestrator; the run journal records the chosen agent or the reported gap.

### Out of scope — deferred (with their own future work)
- **Agent-builder:** on a capability gap, auto-create a new agent in code. Requires its own
  brainstorming session. Slice 2 only builds the *seam* (`report_capability_gap`).
- **Response-format tooling:** shaping the orchestrator's answer into a desired output format. The user
  confirmed this **will be needed in future**; deferred from Slice 2 (YAGNI for proving route-or-gap).
  The orchestrator returns the sub-agent's answer (or a brief composed one) for now.
- Multi-agent *selection among many real specialists*: only file-Q&A ships as a real agent; selection
  among ≥2 agents is proven with **mock agents in tests** (the machinery is N-agent from day one).

## 3. Architecture (small, single-responsibility files)

```
src/core/
  agent-def.ts      # Agent type + runDefinedAgent(agent, task): resolve model -> runAgent
  delegate.ts       # asDelegateTool(agent) -> AI SDK `delegate_to_<name>(task)` tool
  capability-gap.ts # report_capability_gap tool + CapabilityGap type (future-builder seam)
  orchestrator.ts   # createOrchestrator({model, systemPrompt, agents}) + runOrchestrator(task)
  (agent.ts, errors.ts, types.ts unchanged from Slice 1; reuse runAgent + MaxStepsError)
agents/
  file-qa.ts        # the Slice-1 file-Q&A refactored into a reusable Agent definition
  super.ts          # the orchestrator config: own model + routing prompt + agents:[fileQa]
src/cli/
  chat.ts           # now drives the orchestrator (was: file-qa directly)
  answer-file-question.ts  # folded into / replaced by the orchestrator run path
tests/integration/
  ollama-available.ts          # probe: is Ollama up + qwen3:8b installed?
  orchestrator.live.test.ts    # opt-in live test (auto-skips when unavailable)
```

### 3.1 The units

**Prerequisite tweak to Slice 1's `runAgent`** — `src/core/agent.ts`
`runAgent` currently returns `{ text }`. Extend it to **also return the run's `steps`**:
`runAgent(...) : Promise<{ text: string; steps: StepResult[] }>`. This is additive and backward-
compatible (existing `const { text } = await runAgent(...)` callers are unaffected). The orchestrator
needs `steps` to detect the `report_capability_gap` tool call deterministically (§3.2).

**`Agent`** — `src/core/agent-def.ts`
```
type Agent = {
  name: string;            // stable id, e.g. 'file_qa' (used in the delegate tool name)
  description: string;     // capability description the orchestrator routes on
  model: ModelDeclaration; // the agent's own model (resolved to a LanguageModel at run time)
  systemPrompt: string;
  tools: ToolSet;          // the agent's own tools (e.g. file-qa holds read_file)
};
runDefinedAgent(agent: Agent, task: string): Promise<{ text: string; steps: StepResult[] }>
  // resolves agent.model via the provider factory, then calls runAgent(...) and passes through steps
```

**`asDelegateTool`** — `src/core/delegate.ts`
```
asDelegateTool(agent: Agent): Tool
// name: `delegate_to_${agent.name}`, description: agent.description,
// inputSchema: { task: string }, execute: ({task}) => (await runDefinedAgent(agent, task)).text
```

**`report_capability_gap`** — `src/core/capability-gap.ts`
```
type CapabilityGap = { missingCapability: string };
capabilityGapTool: Tool
// name: 'report_capability_gap', inputSchema: { missingCapability: string },
// execute returns a structured marker; detection is done from the run's steps (see below).
```

**`Orchestrator`** — `src/core/orchestrator.ts`
```
createOrchestrator({ model, systemPrompt, agents }): Agent
// returns an Agent whose tools = agents.map(asDelegateTool) + capabilityGapTool
runOrchestrator(orchestrator: Agent, task: string): Promise<OrchestratorResult>
// runs the agent loop; inspects result.steps for a `report_capability_gap` tool call:
//   - if present -> { kind: 'gap', missingCapability, message }
//   - else        -> { kind: 'answer', text }
```
`OrchestratorResult` is a discriminated union (`kind: 'answer' | 'gap'`), so the CLI prints the right
thing and tests assert on `kind` deterministically.

### 3.2 Routing & gap detection
- The orchestrator's **system prompt** lists each agent's name + description and instructs: understand
  the user's intent; if an agent fits, call its `delegate_to_<name>`; if none fits, call
  `report_capability_gap` with the missing capability; **never attempt the task yourself**.
- **Gap detection is deterministic**: `runOrchestrator` examines the `generateText` result's `steps`
  for a tool call named `report_capability_gap` and extracts `missingCapability` — it does **not**
  rely on the model's free-text. (Tool errors are not used as the signal, since the SDK feeds those
  back to the model.)

## 4. Data flow
```
CLI (chat.ts)
  -> runOrchestrator(super, task)            [orchestrator's own model + delegate/gap tools]
       -> model decides:
          (a) delegate_to_file_qa(task)
                -> runDefinedAgent(fileQa, task)   [file-qa's model + read_file MCP tool loop]
                -> answer bubbles up as the tool result
                -> orchestrator returns { kind:'answer', text }
          (b) report_capability_gap(missing)
                -> runOrchestrator returns { kind:'gap', missingCapability, message }
  -> journal records {delegatedTo | gap}; CLI prints answer or gap message
```

## 5. Error handling
- Reuse Slice-1 typed errors (`ProviderError`, `ToolError`, `MaxStepsError`, `ResourceError`).
- Add `DelegationError` for a sub-agent run that fails irrecoverably (surfaced with which agent failed).
- The orchestrator's own loop keeps the `stopWhen: stepCountIs(N)` guard (via `runAgent`).

## 6. Testing strategy (mock model, no Ollama)
- **Delegation path:** mock orchestrator model emits a `delegate_to_file_qa` tool-call; assert the
  sub-agent ran and the answer is returned (`kind:'answer'`).
- **Capability-gap path:** mock model emits `report_capability_gap`; assert `runOrchestrator` returns
  `kind:'gap'` with the missing capability and a clear message — and that **no sub-agent ran**.
- **Multi-agent selection:** register 2+ **mock** agents; mock model picks one; assert only the
  selected delegate's `execute` ran. Proves N-agent routing without a contrived real agent.
- `asDelegateTool` / `runDefinedAgent` unit-tested with a mock model + a trivial tool.
- **Opt-in live integration test** (`tests/integration/orchestrator.live.test.ts`): runs the real
  orchestrator against local Ollama + `qwen3:8b`. It **auto-skips** when Ollama is unreachable
  (`GET /api/version` fails) or the model isn't installed, so `bun test` stays green on any machine.
  When it runs, it asserts: (a) a file question delegates to file-Q&A and returns a correct
  `kind:'answer'`; (b) a clearly out-of-capability request returns `kind:'gap'` (no hallucinated
  attempt). This checks the model's real *judgment*, which the mock tests cannot. A small
  `tests/integration/ollama-available.ts` helper does the reachability/model probe.

## 7. Definition of done
A CLI talking to the orchestrator where: (a) "what does /tmp/x.txt say?" → delegates to file-Q&A →
correct answer; (b) an out-of-scope request → a clear "I don't have a capability to *X* yet" message
with **no hallucinated attempt**; the run journal records which agent ran or that a gap was reported;
full suite green; `bun run typecheck` + `bun run lint` clean.

## 8. Future seams recorded
- `report_capability_gap` → (future) invoke an **agent-builder** that writes a new agent definition.
- Orchestrator answer → (future) **response-format tooling** to shape output (user confirmed needed).
