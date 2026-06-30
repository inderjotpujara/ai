# Slice 10 — Workflow / DAG engine — design

**Date:** 2026-07-01
**Status:** approved (brainstorm complete) → ready for implementation plan
**Depends on:** Slice 2 (agents/orchestrator/delegate), Slice 8 (OTel telemetry + run-viewer), Slice 9 (composition guardrails — depth + return cap)
**Feeds:** Slice 11 (Crews & roles — a role/goal/task layer on this engine), Slice 12 (Memory/RAG — a retrieval step), Slice 13 (Grounded verification — a verifier step). This is the **Phase-B substrate**.

---

## 1. Problem & goal

Today the only orchestration is the **LLM router**: one model picks one specialist (`delegate_to_*`), non-deterministic, one hop. The defining gap vs **both** n8n and CrewAI is **deterministic multi-step orchestration** — a typed graph of steps with explicit data flow that *you* define, instead of a model choosing. This slice adds that as a **second entry mode** that composes on the existing substrate (agents, guardrails, telemetry, run store) rather than replacing it.

### Locked decisions
1. **Code-first, typed, JSON-serializable** (Approach A). A workflow is a TS object built with `defineWorkflow({ id, steps })`; each step is typed with a **zod output schema** and an `input: (ctx) => …` mapper. The shape serializes to JSON so a later visual editor / agent-builder can emit workflows — but no parser/loader is built now.
2. **Step kinds (v1):** `agent` · `tool` · `branch` · `map` (fan-out). Covers real multi-step + parallel workflows from day one.
3. **Fail-fast, declarable per step.** A step failure (agent error, tool throw, **output-schema validation failure**) fails the workflow by default; a step may set `onError: 'continue' | { fallback: <value> }`. Failures become span events + a `failed` outcome (non-zero CLI exit).
4. **Entry = `bun run flow <name>` + a `workflows/` registry**, plus a `runWorkflow(def, input)` core API. A workflow run writes the same `runs/<id>/spans.jsonl` + a result artifact the run-viewer already renders.
5. **Agent steps reuse the existing guarded delegation path** (depth + return-cap guardrails, `withDelegationSpan`, `concise`) — workflows inherit Slice 9 with no new guardrail code. A shared helper is extracted so the engine and the orchestrator's delegate tool use one guarded agent-invocation (DRY, no behavior change).
6. **Bounded concurrency.** Independent steps and `map` fan-out run with a conservative concurrency cap (default small, per-`map` overridable) so parallel agent steps don't thrash the live-RAM budget. Fuller co-resident memory arbitration is an engine-line follow-up.
7. **Telemetry-to-emit (mandated):** a `workflow.run` root span + per-step `workflow.step` spans (`ATTR.WORKFLOW_ID`, `STEP_ID`, `STEP_KIND`), branch-decision + map-fan-out-count as attributes; agent steps still emit `agent.delegation`.
8. **Architecture-doc update (mandated):** add a "Workflow engine" layer/section to `docs/architecture.md` (the hard line).

---

## 2. Components

### 2.1 `src/workflow/types.ts` (new — the typed model)
```ts
import type { z } from 'zod';

export enum StepKind { Agent = 'agent', Tool = 'tool', Branch = 'branch', Map = 'map' }

/** Context threaded through the run: each completed step's validated output, by id. */
export type WorkflowContext = Record<string, unknown>;

export type StepError = 'fail' | 'continue' | { fallback: unknown };

type StepBase<O> = {
  id: string;
  // Execution deps. Default = the previous step in declaration order (linear pipeline);
  // set explicitly for branches / parallel fan-in. (`input` is an opaque fn, so deps are
  // never inferred from it — they are declared.) `[]` = no deps (a root step).
  dependsOn?: string[];
  output: z.ZodType<O>;           // structured I/O — validated after the step runs
  onError?: StepError;            // default 'fail'
};

export type AgentStep<O = unknown> = StepBase<O> & {
  kind: StepKind.Agent;
  agent: string;                   // agent name from the agents/ registry
  input: (ctx: WorkflowContext) => string;   // the task prompt for the agent
};
export type ToolStep<O = unknown> = StepBase<O> & {
  kind: StepKind.Tool;
  tool: string;                    // tool name in the mounted ToolSet
  input: (ctx: WorkflowContext) => unknown;  // tool args (validated by the tool's own schema)
};
export type BranchStep<O = unknown> = StepBase<O> & {
  kind: StepKind.Branch;
  predicate: (ctx: WorkflowContext) => boolean;
  whenTrue: string;                // step id to take when true
  whenFalse: string;               // step id to take when false
};
export type MapStep<O = unknown> = StepBase<O> & {
  kind: StepKind.Map;
  over: (ctx: WorkflowContext) => unknown[];   // the list to map
  step: Omit<AgentStep | ToolStep, 'id' | 'output'> & { output: z.ZodTypeAny }; // sub-step run per item
  maxParallel?: number;            // default = engine default (conservative)
};

export type Step = AgentStep | ToolStep | BranchStep | MapStep;
export type WorkflowDef = { id: string; description?: string; steps: Step[] };

export type WorkflowOutcome =
  | { kind: 'done'; output: WorkflowContext }
  | { kind: 'failed'; failedStep: string; message: string };
```

### 2.2 `src/workflow/define.ts` (new — builder + static validation)
`defineWorkflow(def: WorkflowDef): WorkflowDef` — validates structure at construction: unique step ids; every `dependsOn` / branch target resolves to a real step; the dependency graph is acyclic (topological sort succeeds). Throws a `WorkflowError` (new in `src/core/errors.ts`, extends `FrameworkError`) on a malformed definition.

### 2.3 `src/workflow/engine.ts` (new — executor)
`runWorkflow(def, input, deps): Promise<WorkflowOutcome>`
- Topologically orders steps; runs steps whose deps are satisfied, concurrently up to the bounded cap.
- For each step: build its input via `step.input(ctx)` (or branch/map equivalents), dispatch to the kind runner (§2.4), then **validate the result against `step.output`** (zod `parse`); store `ctx[step.id] = parsed`.
- `branch` selects which downstream id is "live"; non-selected branch arms (and their exclusive descendants) are skipped.
- On a step error or validation failure: apply `onError` (`'fail'` → abort with `{kind:'failed'}`; `'continue'` → record + skip dependents that needed it; `{fallback}` → use the fallback as the step output and continue).
- `deps` (injectable for tests): `runAgentStep`, `tools: ToolSet`, `maxParallel`. Defaults wire to the real agent registry + mounted tools.

### 2.4 `src/workflow/run-step.ts` (new — per-kind runners)
- **agent** → the shared guarded delegation helper (§2.6): resolves the agent from the registry, runs it through `checkDelegation` + `withDelegationSpan` + `runInDelegationContext` + `runDefinedAgent` + `concise`. Returns the agent text (the step's `output` schema validates/parses it — e.g. `z.string()` or a structured schema the agent is prompted to emit).
- **tool** → look up `tool` in the `ToolSet`, call `execute(args)`, return its result.
- **branch** → evaluate `predicate`; output `{ taken: 'whenTrue'|'whenFalse' }` (recorded as a span attribute); engine uses it for path selection.
- **map** → `over(ctx)` → run `step` per item with bounded parallelism; output = the array of per-item validated results.

### 2.5 `src/cli/flow.ts` (new — entry) + `workflows/` (new — registry)
- `bun run flow <name> [input...]` (package.json: `"flow": "bun run src/cli/flow.ts"`). Loads `<name>` from the `workflows/` registry (an index mapping name → `WorkflowDef`, like `models/registry.ts`), calls `runWorkflow`, writes `runs/<id>/{spans.jsonl, result.txt|failed.txt}`, prints the result; non-zero exit on `failed`. Mounts the same MCP tools `chat.ts` does so `tool` steps work.
- `workflows/` ships ≥1 real example (e.g. `fetch-then-summarize`: a `tool` fetch step → an `agent` summarize step) + an `index.ts`.

### 2.6 `src/core/delegate.ts` (light extract — DRY, no behavior change)
Extract the guarded agent-invocation body of `asDelegateTool.execute` into a shared `runGuardedAgent(agent, task, onBeforeDelegate?)` used by both the delegate tool and `run-step.ts`'s agent runner — so guardrails (depth/cycle), `withDelegationSpan`, `runInDelegationContext`, and `concise` apply identically in both paths. The orchestrator's delegate tool behavior is unchanged.

### 2.7 `src/telemetry/spans.ts` (extend)
`ATTR` gains `WORKFLOW_ID: 'workflow.id'`, `STEP_ID: 'workflow.step.id'`, `STEP_KIND: 'workflow.step.kind'`. New `withWorkflowSpan(workflowId, fn)` (root `workflow.run`) and `withStepSpan(stepId, kind, fn)` (`workflow.step`, tags id+kind); branch decision + map item count set as attributes. Run lifecycle (init/shutdown) mirrors `run-chat.ts`.

---

## 3. Data flow
```
flow <name>  (or runWorkflow(def, input))
  → initRunTelemetry(runDir) + withWorkflowSpan(def.id)        root: workflow.run
    → topological execute:
        for each ready step (bounded concurrency):
          withStepSpan(step.id, step.kind):
            input = step.input(ctx)            (typed, reads prior outputs)
            result = run by kind:
              agent → runGuardedAgent(agent, task)   → nests agent.delegation (depth + concise)
              tool  → toolSet[tool].execute(args)
              branch→ predicate(ctx) → pick live path
              map   → bounded-parallel sub-runs over over(ctx)
            ctx[step.id] = step.output.parse(result)     structured-I/O validation
        on step failure → onError policy ('fail' aborts; 'continue'/{fallback} proceed)
  → outcome {done|failed} → writeArtifact(result.txt|failed.txt) + flush spans
  → `bun run runs <id>` renders workflow.run → workflow.step → agent.delegation tree
```

## 4. Error handling & determinism
- DAGs are finite + acyclic (enforced at `defineWorkflow`), so no runaway; `map` is bounded by the input list + a concurrency cap.
- Fail-fast default; per-step `onError` for resilience (ties into Phase-A graceful degradation later). Output-schema validation failure is a step failure.
- Telemetry/guardrail helpers never throw into the run (existing contract). The engine catches step errors and converts them to the `onError` policy + a span event; an unexpected engine error → `{kind:'failed'}`, never an unhandled crash.
- Concurrency capped so parallel agent steps don't evict each other under the live RAM budget (conservative default; per-`map` override).

## 5. Testing (TDD)
- **`tests/workflow/define.test.ts`** — unique-id / unknown-dep / cycle rejection; valid def passes.
- **`tests/workflow/engine.test.ts`** — linear chain threads context; output-schema validation rejects a bad output (step fails); `branch` takes the correct arm + skips the other; `map` fans out over a list (bounded) and collects results; fail-fast aborts vs `onError:'continue'` proceeds vs `{fallback}` substitutes. Uses injected `deps` (stub `runAgentStep` + stub `ToolSet`) — no model.
- **`tests/workflow/run-step.test.ts`** — agent runner goes through the guarded path (assert an `agent.delegation` span via `registerTestProvider`); tool runner calls `execute`.
- **`tests/cli/flow.test.ts`** — `runWorkflow` over a temp `runsRoot` with `MockLanguageModelV3` agents writes `spans.jsonl` containing `workflow.run` + `workflow.step` spans + the artifact; failed workflow → `failed` outcome.
- **`tests/integration/workflow.live.test.ts`** (skips if Ollama down) — a real 2-step workflow (tool fetch → agent summarize) produces a coherent span tree.
- Regression: existing orchestrator/delegate tests still pass after the `runGuardedAgent` extract.

## 6. Out of scope (later)
Declarative JSON/YAML loader + visual editor (shape is serializable; loader deferred) · crews/roles (Slice 11) · RAG + verification steps (Slices 12–13) · durable/resumable workflows + triggers (Phase E) · fuller co-resident fan-out memory arbitration (engine-line) · streaming step output.

## 7. Acceptance
- `bun run check` green (docs-check · typecheck · lint · test); live tests skip cleanly when Ollama is down.
- `defineWorkflow` rejects malformed graphs; the engine runs agent/tool/branch/map with typed, schema-validated data flow; fail-fast + per-step `onError` behave as specified.
- `bun run flow fetch-then-summarize <url>` runs end-to-end (live), writes `runs/<id>/spans.jsonl`; `bun run runs <id>` shows `workflow.run → workflow.step → agent.delegation`.
- Agent steps enforce the Slice-9 guardrails (depth + return cap) via the shared `runGuardedAgent`.
- No regression to the LLM-orchestrator path.
- `docs/architecture.md` gains a Workflow-engine section (passes `docs:check`).
