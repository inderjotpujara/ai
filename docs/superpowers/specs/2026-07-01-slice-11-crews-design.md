# Slice 11 — Crews & roles — design

**Date:** 2026-07-01
**Status:** approved (brainstorm complete) → ready for implementation plan
**Depends on:** Slice 2 (agents/orchestrator/delegate), Slice 5 (live model selection via `modelReq`), Slice 9 (guardrails — depth + return cap), Slice 10 (workflow/DAG engine + telemetry).
**Feeds:** Slice 12 (Memory/RAG — crew members will *read* from it), Slice 13 (grounded verification — a verifier is just another member/task).

---

## 1. Problem & goal

We have two orchestration primitives: the **LLM router** (agents-as-tools, non-deterministic) and the **deterministic workflow DAG** (Slice 10). We lack the **CrewAI layer**: agents with an explicit **role + goal**, a **task list**, and a **process** (sequential or hierarchical) that assembles a *team working toward a goal*. This slice adds that as a thin composition layer.

### Validated framing (latest CrewAI, 2026)
A crew reduces to three things: **(1)** `role`/`goal`/`backstory` on an agent — *pure prompt scaffolding* (three strings composed into the system prompt; no structural machinery); **(2)** `Task`s = description + expected-output + dependency `context`; **(3)** a **process** — `sequential` or `hierarchical` (a manager delegating to capability-matched workers). Modern CrewAI also splits **Flows** (deterministic orchestration) from **Crews** (autonomous collaboration).

**We already own the substrate**, so most of "crews" is naming + two compile functions, not a new engine:
- **Sequential process** ≈ a linear **workflow of agent steps** → the Slice-10 DAG (our zod I/O is *stronger* than CrewAI's `output_pydantic`).
- **Hierarchical process** ≈ a **manager delegating to workers** → the **agents-as-tools orchestrator already is this**.
- **"Flows"** ≈ what our workflow DAG already is — not built.
- **Memory** — deferred to Slice 12; NOT part of the crews layer.

### Locked decisions (from brainstorm)
1. **Both processes** ship: `sequential` compiles to a `WorkflowDef` (runs on the Slice-10 engine unchanged); `hierarchical` reuses `createOrchestrator` + a manager.
2. **Define-your-own members.** A crew declares its own members (`{name, role, goal, backstory, requires, prefer, tools?}`); the model is resolved **live by the existing selector** (largest-that-fits) via `onBeforeDelegate`, exactly like today's agents. Not limited to the 3 preset agents.
3. **Optional per-task zod output.** A `Task` may declare a zod `output` schema (validated via the Slice-10 `safeParse` path, passed typed to downstream tasks); if omitted, the task returns free text (default).
4. **Auto-built hierarchical manager** — reuse `createOrchestrator`; manager model defaults to the router (`managerModel` overridable). Zero hand-written manager code.
5. **No new engine / no parallel structured-output system / no Flows / no memory** — reuse or defer.
6. **Entry = `bun run crew <name>` + a `crews/` registry**, plus a `runCrew(def, input, deps)` core API. A crew run writes the same `runs/<id>/spans.jsonl` + artifact the run-viewer renders.
7. **Telemetry-to-emit (mandated):** a `crew.run` root span (`ATTR.CREW_ID`, `CREW_PROCESS`) under which the existing `workflow.run/workflow.step` (sequential) or `agent.delegation` (hierarchical) spans nest, annotated with the member (`ATTR.CREW_TASK_MEMBER`).
8. **Architecture-doc update (mandated):** add a "Crews & roles" section (§13) + module-map `src/crew/` node/edges to `docs/architecture.md`.

---

## 2. Components (new dir `src/crew/`)

### 2.1 `src/crew/types.ts` (the typed model)
```ts
import type { ToolSet } from 'ai';
import type { z } from 'zod';
import type { Capability, PreferPolicy } from '../core/types.ts';
import type { ModelDeclaration } from '../core/types.ts';

/** A role-bearing team member. role/goal/backstory are prompt scaffolding;
 *  the concrete model is resolved live by the selector from requires/prefer. */
export type CrewMember = {
  name: string;                 // stable id; used as the agent name + delegate tool name
  role: string;                 // e.g. "Senior Research Analyst"
  goal: string;                 // the member's individual objective
  backstory: string;            // persona/context that enriches its prompt
  requires: Capability[];       // capability hard-filter for model selection
  prefer: PreferPolicy;         // e.g. LargestThatFits
  tools?: ToolSet;              // optional tools this member can call
};

/** A unit of work assigned to a member. expectedOutput is prompt guidance;
 *  output (optional) is the enforced zod schema for typed hand-offs. */
export type Task<O = unknown> = {
  id: string;
  description: string;          // what to do (prompt)
  expectedOutput: string;       // what good output looks like (prompt guidance)
  member: string;               // CrewMember.name that runs this task
  dependsOn?: string[];         // upstream task ids whose outputs are context (CrewAI `context`)
  output?: z.ZodType<O>;        // optional structured output; validated if present
};

export enum CrewProcess { Sequential = 'sequential', Hierarchical = 'hierarchical' }

export type CrewDef = {
  id: string;
  description?: string;
  members: CrewMember[];
  tasks: Task[];
  process: CrewProcess;
  managerModel?: ModelDeclaration; // hierarchical only; defaults to the router
};

export type CrewOutcome =
  | { kind: 'done'; output: unknown }        // sequential: the WorkflowContext; hierarchical: the manager's answer
  | { kind: 'failed'; failedTask?: string; message: string };
```

### 2.2 `src/crew/member-agent.ts` (the one real new mechanism)
`buildCrewAgent(member: CrewMember, tools?: ToolSet): Agent` — composes `role`/`goal`/`backstory` (+ a standard crew preamble) into an `Agent.systemPrompt`; sets `Agent.description` from role+goal (used for hierarchical routing); sets `Agent.modelReq = { role: member.role, requires: member.requires, prefer: member.prefer }` so the live selector picks the model; merges `member.tools ?? tools`. No model is bound here — selection stays live (same path as preset agents).

### 2.3 `src/crew/define.ts` (builder + static validation)
`defineCrew(def: CrewDef): CrewDef` — validates at construction: unique member names; unique task ids; every `task.member` resolves to a member; every `dependsOn` resolves to a task; and (sequential) the task graph is acyclic. Throws `CrewError` (new in `src/core/errors.ts`, extends `FrameworkError`) on any violation.

### 2.4 `src/crew/compile.ts` (the two constructors)
- **Sequential → `compileToWorkflow(crew): WorkflowDef`** — each `Task` → an `AgentStep`: `agent = task.member`; `dependsOn = task.dependsOn` (the CrewAI `context` edges). The member's persona already lives in its agent `systemPrompt` (via `buildCrewAgent`), so the step's `input(ctx)` composes only the *task-specific* prompt = `task.description` + `task.expectedOutput` + the referenced upstream outputs (`ctx[depId]` for each dep). `output = task.output ?? z.string()`. Returns a `WorkflowDef` run by the **existing** Slice-10 engine (no engine change). `defineWorkflow` is applied to the compiled def as a second validation.
- **Hierarchical → `buildHierarchicalOrchestrator(crew): Agent`** — build member `Agent`s via `buildCrewAgent`; `createOrchestrator({ name: crew.id, model: createOllamaModel(crew.managerModel ?? qwenRouter), systemPrompt: <manager prompt from crew.description + goal + the task list>, agents: members, onBeforeDelegate })`. The existing orchestrator IS the manager.

### 2.5 `src/crew/engine.ts` (dispatcher)
`runCrew(def, input, deps): Promise<CrewOutcome>` — `withCrewSpan(def.id, def.process, …)` wrapping:
- **sequential:** `compileToWorkflow(def)` → `runWorkflow(wf, input, { runAgentStep, tools })` where `runAgentStep` resolves member agents (built via `buildCrewAgent`) through `runGuardedAgent`. Map `WorkflowOutcome` → `CrewOutcome`.
- **hierarchical:** `buildHierarchicalOrchestrator(def)` → `runOrchestrator(orch, <composite task from input + tasks>)`. Map `OrchestratorResult` → `CrewOutcome`.
`deps` (injectable for tests): `{ runAgentStep?, tools, maxParallel? }`; defaults wire member agents + mounted tools.

### 2.6 `src/core/errors.ts` (extend)
`export class CrewError extends FrameworkError {}` — matches the existing subclass pattern (`name` set by the base via `new.target.name`).

### 2.7 `src/telemetry/spans.ts` (extend — additive)
`ATTR` gains `CREW_ID: 'crew.id'`, `CREW_PROCESS: 'crew.process'`, `CREW_TASK_MEMBER: 'crew.task.member'`. New `withCrewSpan(crewId, process, fn)` (root `crew.run`). The existing `workflow.run/workflow.step` (sequential) and `agent.delegation` (hierarchical) spans nest beneath it unchanged; `annotateStep`/an annotate helper tags the running member. Transport/OTLP seam untouched.

### 2.8 `src/cli/crew.ts` (entry) + `crews/` (registry)
- `bun run crew <name> [input...]` (package.json: `"crew": "bun run src/cli/crew.ts"`). Mirrors `flow.ts`: mount the same MCP tools, `getCrew(name)`, build member agents, `runCrew`, write `runs/<id>/{spans.jsonl, result.txt|failed.txt}`, print result / non-zero exit on `failed`.
- `crews/index.ts` (`CREWS: Record<string, CrewDef>` + `getCrew`) + ≥1 real example: a **sequential research crew** — member `researcher` (fetch tools) runs a "gather" task → member `writer` runs a "summarize" task consuming the researcher's output.

---

## 3. Data flow
```
crew <name>  (or runCrew(def, input))
  → withCrewSpan(def.id, def.process)                     root: crew.run
    sequential:  compileToWorkflow(def) → runWorkflow(...)   → workflow.run → workflow.step (per task) → agent.delegation
    hierarchical: buildHierarchicalOrchestrator(def) → runOrchestrator(composite task)  → agent.delegation (manager routes to members)
  → CrewOutcome {done|failed} → writeArtifact(result.txt|failed.txt) + flush spans
  → `bun run runs <id>` renders crew.run → (workflow.step | agent.delegation) tree
```
Member model selection, depth/return guardrails, and typed step I/O are all inherited from Slices 5/9/10 unchanged.

## 4. Error handling & determinism
- **Sequential = deterministic** (DAG; fail-fast + per-task `onError` via the engine; acyclic enforced at `defineCrew` + `defineWorkflow`).
- **Hierarchical = autonomous** (manager decides allocation; bounded by the Slice-9 depth guard so it always terminates).
- `defineCrew` rejects malformed crews at construction. `runCrew` never throws into the caller (engine + orchestrator both already uphold this).

## 5. Testing (TDD)
- `tests/crew/define.test.ts` — unique-name/id, unknown-member, unknown-dep, cycle rejection; valid crew passes.
- `tests/crew/member-agent.test.ts` — `buildCrewAgent` composes role/goal/backstory into systemPrompt + sets description + modelReq; no model bound.
- `tests/crew/compile.test.ts` — sequential crew → a `WorkflowDef` with one `AgentStep` per task, deps preserved, `output` defaulting to `z.string()`.
- `tests/crew/engine.test.ts` — sequential threads typed context between tasks (stub `runAgentStep`); hierarchical routes via a mock manager/orchestrator (no model). Uses injected deps.
- `tests/cli/crew.test.ts` — `runCrew` over a temp `runsRoot` with `MockLanguageModelV3` members writes `spans.jsonl` (`crew.run` + nested spans) + the artifact; failed crew → `failed` outcome.
- `tests/integration/crew.live.test.ts` (skips if Ollama down) — a real 2-member sequential research crew produces a coherent span tree.
- Regression: existing workflow + orchestrator tests still pass (crews only *use* them).

## 6. Out of scope (later)
Memory/RAG (Slice 12 — members read from it, not part of crews) · grounded verification (Slice 13 — a verifier is another member/task) · CrewAI "Flows" (our DAG already is that) · planning / `kickoff_for_each` batch · human-in-the-loop tasks · async task execution beyond the engine's existing bounded concurrency.

## 7. Acceptance
- `bun run check` green (docs-check · typecheck · lint · test); live tests skip cleanly when Ollama is down.
- `defineCrew` rejects malformed crews; a sequential crew compiles to and runs on the Slice-10 engine with typed context between tasks; a hierarchical crew delegates via the existing orchestrator + manager.
- Members enforce the Slice-9 guardrails and use the live model selector (no hardcoded models).
- `bun run crew <name> <input>` runs end-to-end (live), writes `runs/<id>/spans.jsonl`; `bun run runs <id>` shows `crew.run → (workflow.step | agent.delegation)`.
- No regression to the workflow engine or the orchestrator.
- `docs/architecture.md` gains a Crews section (passes `docs:check`).
