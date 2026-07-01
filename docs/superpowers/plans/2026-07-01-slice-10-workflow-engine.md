# Slice 10 — Workflow / DAG Engine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a second, deterministic orchestration mode — a typed, JSON-serializable DAG of steps (`agent`/`tool`/`branch`/`map`) with zod-validated data flow between steps — that composes on the existing agent/guardrail/telemetry substrate instead of replacing the LLM router.

**Architecture:** A workflow is a plain TS object built with `defineWorkflow({ id, steps })`; `defineWorkflow` statically validates it (unique ids, resolvable deps, acyclic). `runWorkflow(def, input, deps)` topologically executes steps with bounded concurrency, validates each step's output with zod `safeParse`, and threads validated outputs through a `WorkflowContext` keyed by step id. Agent steps reuse the Slice-9 guarded delegation path via a shared `runGuardedAgent` extracted from `delegate.ts` (DRY, no behavior change). A `workflow.run` root span + per-step `workflow.step` spans write to the same `runs/<id>/spans.jsonl` the run-viewer already renders. `bun run flow <name>` is the CLI entry over a `workflows/` registry.

**Tech Stack:** TypeScript + Bun · Vercel AI SDK `ai@^6.0.214` (`ToolSet`, `tool`) · `zod@^4.4.3` (step I/O schemas; use `safeParse`) · OpenTelemetry (existing `src/telemetry/*` Bun-safe provider) · `bun test` + `MockLanguageModelV3` from `ai/test` + `registerTestProvider`.

## Global Constraints

- **Always `bun`, never `npm`.** Run `bun run typecheck`, `bun test`, `bun run lint` (biome).
- **Prefer `enum` over string-literal unions** for finite named sets (string enums only). Discriminated unions stay as `type` with an enum discriminator. Prefer `type` over `interface`. Early returns; small focused files; descriptive names.
- **Don't hardcode budgets/limits** — compute live; env vars fallback-only. The workflow concurrency cap is a *thrash-avoidance hint* (the model manager's live-RAM budget is the real guard); default small + env/`maxParallel` overridable.
- **Documentation hard line:** this slice MUST add a "Workflow engine" section to `docs/architecture.md` or `bun run docs:check` (pre-commit hook) fails. Run `bun run setup` once to activate hooks.
- **No `console.log` left behind; no commit without `bun run typecheck`; no skipped tests.**
- **Telemetry-by-default:** every step emits a span; agent steps still emit `agent.delegation`.
- New error type extends `FrameworkError` (`src/core/errors.ts`); `name` is set automatically via `new.target.name` — do not set it manually.
- Existing dep edge default: a step with no `dependsOn` depends on the **previous step in declaration order**; `dependsOn: []` makes it a root. This rule is shared by `define.ts` (cycle check) and `engine.ts` (scheduling) — implement it once as `effectiveDeps(step, index, steps)`.
- **v1 branch constraint:** branch arms are independent tails — no fan-in/join step depending on *both* arms (deferred). A step is skipped if **any** of its effective deps is skipped.

---

## File structure

| File | Responsibility |
|------|----------------|
| `src/workflow/types.ts` (new) | Typed model: `StepKind` enum, `Step`/`AgentStep`/`ToolStep`/`BranchStep`/`MapStep`, `WorkflowDef`, `WorkflowContext`, `WorkflowOutcome`, `StepError`, `effectiveDeps` helper |
| `src/core/errors.ts` (modify) | Add `WorkflowError extends FrameworkError` |
| `src/workflow/define.ts` (new) | `defineWorkflow(def)` — static validation (unique ids, resolvable deps + branch targets, acyclic via Kahn topo-sort) |
| `src/core/delegate.ts` (modify) | Extract `runGuardedAgent(agent, task, onBeforeDelegate?)`; `asDelegateTool` delegates to it (no behavior change) |
| `src/telemetry/spans.ts` (modify) | Add `ATTR.WORKFLOW_ID/STEP_ID/STEP_KIND/STEP_BRANCH_TAKEN/STEP_MAP_COUNT/WORKFLOW_OUTCOME`; `withWorkflowSpan`, `withStepSpan`, `annotateStep` |
| `src/workflow/run-step.ts` (new) | Per-kind runners: `runStepByKind(step, ctx, deps)` (agent→`runAgentStep`, tool→`tools[t].execute`, branch→predicate, map→bounded sub-runs); `mapWithConcurrency` helper |
| `src/workflow/engine.ts` (new) | `runWorkflow(def, input, deps)` — topo schedule + bounded concurrency + `safeParse` validation + `onError` policy + branch skip propagation; `WorkflowDeps` type + default `runAgentStep` factory |
| `src/cli/flow.ts` (new) | `bun run flow <name> [input...]` — mount MCP tools, build agent map, look up workflow, run, write `runs/<id>/{spans.jsonl,result.txt|failed.txt}`, non-zero exit on failure |
| `workflows/index.ts` + `workflows/fetch-then-summarize.ts` (new) | Registry array + ≥1 real example (tool fetch → agent summarize) |
| `package.json` (modify) | Add `"flow": "bun run src/cli/flow.ts"` |
| `docs/architecture.md` (modify) | New "§12. Workflow engine" section (module map edge + data flow) |
| `tests/workflow/{define,engine,run-step}.test.ts`, `tests/cli/flow.test.ts`, `tests/integration/workflow.live.test.ts` (new) | TDD coverage |

---

## Task 1: Typed workflow model + `WorkflowError`

**Files:**
- Create: `src/workflow/types.ts`
- Modify: `src/core/errors.ts` (add `WorkflowError` after `ResourceError`, ~line 25)
- Test: `tests/workflow/errors.test.ts`

**Interfaces:**
- Produces: `enum StepKind`; types `WorkflowContext`, `StepError`, `AgentStep`, `ToolStep`, `BranchStep`, `MapStep`, `MapSubStep`, `Step`, `WorkflowDef`, `WorkflowOutcome`; `function effectiveDeps(step, index, steps): string[]`. `class WorkflowError extends FrameworkError`.

- [ ] **Step 1: Add `WorkflowError` to `src/core/errors.ts`**

Match the existing pattern (base sets `name` via `new.target.name`; subclass only needs `super(message)`):

```typescript
export class WorkflowError extends FrameworkError {}
```

(Place it alongside `ResourceError`. No constructor needed — it inherits the base, which sets `name = 'WorkflowError'` automatically.)

- [ ] **Step 2: Write `src/workflow/types.ts`**

```typescript
import type { z } from 'zod';

/** The four step kinds supported in v1. */
export enum StepKind {
  Agent = 'agent',
  Tool = 'tool',
  Branch = 'branch',
  Map = 'map',
}

/** Context threaded through a run: each completed step's validated output, by id.
 *  `input` holds the workflow's initial input; `map` sub-steps also see `item`/`index`. */
export type WorkflowContext = Record<string, unknown>;

/** Per-step failure policy. Default 'fail' (fail-fast). */
export type StepError = 'fail' | 'continue' | { fallback: unknown };

type StepBase<O> = {
  id: string;
  /** Execution deps. Omitted = previous step in declaration order (linear pipeline).
   *  `[]` = a root step. Branch/parallel fan-in set these explicitly. */
  dependsOn?: string[];
  /** Structured I/O — the step's result is validated against this after it runs. */
  output: z.ZodType<O>;
  /** Failure policy; default 'fail'. */
  onError?: StepError;
};

export type AgentStep<O = unknown> = StepBase<O> & {
  kind: StepKind.Agent;
  agent: string; // agent name resolved from the agent map at run time
  input: (ctx: WorkflowContext) => string; // the task prompt for the agent
};

export type ToolStep<O = unknown> = StepBase<O> & {
  kind: StepKind.Tool;
  tool: string; // tool name in the mounted ToolSet
  input: (ctx: WorkflowContext) => unknown; // tool args (validated by the tool's own schema)
};

export type BranchStep<O = unknown> = StepBase<O> & {
  kind: StepKind.Branch;
  predicate: (ctx: WorkflowContext) => boolean;
  whenTrue: string; // step id taken when predicate true
  whenFalse: string; // step id taken when predicate false
};

/** A map sub-step is an agent/tool step run once per item; id is synthesized,
 *  deps are implicit (the item), so they are omitted. */
export type MapSubStep =
  | (Omit<AgentStep, 'id' | 'dependsOn'>)
  | (Omit<ToolStep, 'id' | 'dependsOn'>);

export type MapStep<O = unknown> = StepBase<O> & {
  kind: StepKind.Map;
  over: (ctx: WorkflowContext) => unknown[]; // the list to map
  step: MapSubStep; // sub-step run per item (sees ctx.item / ctx.index)
  maxParallel?: number; // per-map override of the engine concurrency cap
};

export type Step = AgentStep | ToolStep | BranchStep | MapStep;

export type WorkflowDef = {
  id: string;
  description?: string;
  steps: Step[];
};

export type WorkflowOutcome =
  | { kind: 'done'; output: WorkflowContext }
  | { kind: 'failed'; failedStep: string; message: string };

/** The effective dependencies of a step: explicit `dependsOn`, else the previous
 *  step in declaration order (first step => no deps). Shared by define + engine. */
export function effectiveDeps(
  step: Step,
  index: number,
  steps: Step[],
): string[] {
  if (step.dependsOn) return step.dependsOn;
  return index === 0 ? [] : [steps[index - 1].id];
}
```

- [ ] **Step 3: Write the failing test `tests/workflow/errors.test.ts`**

```typescript
import { describe, expect, it } from 'bun:test';
import { WorkflowError } from '../../src/core/errors.ts';

describe('WorkflowError', () => {
  it('is an Error with the right name', () => {
    const e = new WorkflowError('bad def');
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('WorkflowError');
    expect(e.message).toBe('bad def');
  });
});
```

- [ ] **Step 4: Run tests**

Run: `bun test tests/workflow/errors.test.ts && bun run typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/workflow/types.ts src/core/errors.ts tests/workflow/errors.test.ts
git commit -m "feat(workflow): typed step model + WorkflowError"
```

---

## Task 2: `defineWorkflow` static validation

**Files:**
- Create: `src/workflow/define.ts`
- Test: `tests/workflow/define.test.ts`

**Interfaces:**
- Consumes: `WorkflowDef`, `Step`, `StepKind`, `effectiveDeps` (Task 1); `WorkflowError` (Task 1).
- Produces: `function defineWorkflow(def: WorkflowDef): WorkflowDef` — returns the def unchanged if valid, throws `WorkflowError` otherwise.

- [ ] **Step 1: Write the failing test `tests/workflow/define.test.ts`**

```typescript
import { describe, expect, it } from 'bun:test';
import { z } from 'zod';
import { defineWorkflow } from '../../src/workflow/define.ts';
import { StepKind } from '../../src/workflow/types.ts';

const agent = (id: string, dependsOn?: string[]) => ({
  id,
  kind: StepKind.Agent as const,
  agent: 'web_fetch',
  input: () => 'hi',
  output: z.string(),
  ...(dependsOn ? { dependsOn } : {}),
});

describe('defineWorkflow', () => {
  it('accepts a valid linear workflow', () => {
    const def = defineWorkflow({ id: 'wf', steps: [agent('a'), agent('b')] });
    expect(def.steps).toHaveLength(2);
  });

  it('rejects duplicate step ids', () => {
    expect(() =>
      defineWorkflow({ id: 'wf', steps: [agent('a'), agent('a')] }),
    ).toThrow(/duplicate step id/i);
  });

  it('rejects an unknown dependsOn target', () => {
    expect(() =>
      defineWorkflow({ id: 'wf', steps: [agent('a'), agent('b', ['ghost'])] }),
    ).toThrow(/unknown.*ghost/i);
  });

  it('rejects an unknown branch target', () => {
    const branch = {
      id: 'br',
      kind: StepKind.Branch as const,
      predicate: () => true,
      whenTrue: 'a',
      whenFalse: 'ghost',
      output: z.object({ taken: z.string() }),
      dependsOn: [] as string[],
    };
    expect(() =>
      defineWorkflow({ id: 'wf', steps: [branch, agent('a', ['br'])] }),
    ).toThrow(/unknown.*ghost/i);
  });

  it('rejects a dependency cycle', () => {
    expect(() =>
      defineWorkflow({
        id: 'wf',
        steps: [agent('a', ['b']), agent('b', ['a'])],
      }),
    ).toThrow(/cycle/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/workflow/define.test.ts`
Expected: FAIL — `defineWorkflow` not defined.

- [ ] **Step 3: Write `src/workflow/define.ts`**

```typescript
import { WorkflowError } from '../core/errors.ts';
import { StepKind, type WorkflowDef, effectiveDeps } from './types.ts';

/** Validate a workflow definition at construction:
 *  unique ids · resolvable deps + branch targets · acyclic dependency graph. */
export function defineWorkflow(def: WorkflowDef): WorkflowDef {
  const { steps } = def;
  const ids = new Set<string>();
  for (const step of steps) {
    if (ids.has(step.id)) {
      throw new WorkflowError(`duplicate step id: ${step.id}`);
    }
    ids.add(step.id);
  }

  // Every dependsOn (explicit) and branch target must resolve to a real step.
  steps.forEach((step, i) => {
    for (const dep of effectiveDeps(step, i, steps)) {
      if (!ids.has(dep)) {
        throw new WorkflowError(
          `step ${step.id}: unknown dependsOn target "${dep}"`,
        );
      }
    }
    if (step.kind === StepKind.Branch) {
      for (const target of [step.whenTrue, step.whenFalse]) {
        if (!ids.has(target)) {
          throw new WorkflowError(
            `branch ${step.id}: unknown target "${target}"`,
          );
        }
      }
    }
  });

  // Acyclic check via Kahn's topological sort over the effective-deps graph.
  const indeg = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  steps.forEach((s) => {
    indeg.set(s.id, 0);
    dependents.set(s.id, []);
  });
  steps.forEach((step, i) => {
    for (const dep of effectiveDeps(step, i, steps)) {
      indeg.set(step.id, (indeg.get(step.id) ?? 0) + 1);
      dependents.get(dep)?.push(step.id);
    }
  });
  const queue = [...indeg.entries()].filter(([, d]) => d === 0).map(([id]) => id);
  let visited = 0;
  while (queue.length > 0) {
    const id = queue.shift() as string;
    visited++;
    for (const next of dependents.get(id) ?? []) {
      const d = (indeg.get(next) ?? 0) - 1;
      indeg.set(next, d);
      if (d === 0) queue.push(next);
    }
  }
  if (visited !== steps.length) {
    throw new WorkflowError(`workflow ${def.id} has a dependency cycle`);
  }

  return def;
}
```

- [ ] **Step 4: Run tests**

Run: `bun test tests/workflow/define.test.ts && bun run typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/workflow/define.ts tests/workflow/define.test.ts
git commit -m "feat(workflow): defineWorkflow static graph validation"
```

---

## Task 3: Extract `runGuardedAgent` (DRY, no behavior change)

**Files:**
- Modify: `src/core/delegate.ts` (extract the `execute` body, ~lines 44–70)
- Test: `tests/core/delegate.test.ts` (add a direct test; existing tests are the regression gate)

**Interfaces:**
- Produces: `function runGuardedAgent(agent: Agent, task: string, onBeforeDelegate?: BeforeDelegate): Promise<{ text: string } | { error: string }>`. Wraps `withDelegationSpan` + `checkDelegation` + `concise` + `runInDelegationContext` + `runDefinedAgent` (identical to today's delegate-tool body).
- Consumes (by Task 5): `runGuardedAgent`.

- [ ] **Step 1: Read the current body to extract**

The current `asDelegateTool` execute (lines 44–70) is the source of truth. Extract its inner async function verbatim into `runGuardedAgent`, keeping all imports already present in `delegate.ts` (`withDelegationSpan`, `checkDelegation`, `recordGuardrailViolation`, `currentDelegationContext`, `runInDelegationContext`, `runDefinedAgent`, `concise`).

- [ ] **Step 2: Add `runGuardedAgent` and rewire `asDelegateTool` in `src/core/delegate.ts`**

Add the exported function (place it above `asDelegateTool`):

```typescript
/** Run an agent through the full Slice-9 guarded delegation path:
 *  delegation span · depth guard · before-delegate hook · context wrap · return cap.
 *  Shared by the orchestrator's delegate tool and the workflow engine's agent step. */
export function runGuardedAgent(
  agent: Agent,
  task: string,
  onBeforeDelegate?: BeforeDelegate,
): Promise<{ text: string } | { error: string }> {
  return withDelegationSpan(agent.name, async () => {
    const check = checkDelegation(agent.name);
    if (!check.ok) {
      recordGuardrailViolation(check.kind, check.reason);
      return { error: check.reason };
    }
    const callerNumCtx = currentDelegationContext().numCtx;
    try {
      const pre = onBeforeDelegate ? await onBeforeDelegate(agent) : undefined;
      if (pre?.abort) {
        return { error: pre.abort };
      }
      const { text } = await runInDelegationContext(
        agent.name,
        pre?.numCtx,
        () => runDefinedAgent(agent, task, pre?.numCtx, pre?.model),
      );
      return { text: concise(text, callerNumCtx) };
    } catch (cause) {
      return {
        error: `Agent ${agent.name} failed: ${(cause as Error).message}`,
      };
    }
  });
}
```

Then collapse the tool's `execute` to delegate to it (behavior is byte-identical — same span, same guard, same cap):

```typescript
    execute: async ({ task }) => runGuardedAgent(agent, task, onBeforeDelegate),
```

- [ ] **Step 3: Add a direct regression test in `tests/core/delegate.test.ts`**

Mirror the existing `MockLanguageModelV3` + `registerTestProvider` pattern already in this file. Add:

```typescript
import { runGuardedAgent } from '../../src/core/delegate.ts';
import { withRootDelegationContext } from '../../src/core/guardrails.ts';

it('runGuardedAgent returns concise text and emits an agent.delegation span', async () => {
  const { exporter } = registerTestProvider();
  const agent = {
    name: 'web_fetch',
    description: 'fetch',
    model: new MockLanguageModelV3({
      doGenerate: async () => ({
        content: [{ type: 'text', text: 'done' }],
        finishReason: { unified: 'stop', raw: undefined },
        usage: {
          inputTokens: { total: 1, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 1, text: undefined, reasoning: undefined },
        },
        warnings: [],
      }),
    }),
    systemPrompt: 'x',
    tools: {},
  };
  const result = await withRootDelegationContext(8192, () =>
    runGuardedAgent(agent, 'summarize'),
  );
  expect(result).toEqual({ text: 'done' });
  const del = exporter
    .getFinishedSpans()
    .find((s) => s.name === 'agent.delegation');
  expect(del?.attributes['agent.delegation.target']).toBe('web_fetch');
});
```

(If the existing test file already constructs a canned agent helper, reuse it instead of duplicating the `MockLanguageModelV3` literal — DRY.)

- [ ] **Step 4: Run the full delegate suite (regression) + typecheck**

Run: `bun test tests/core/delegate.test.ts && bun run typecheck`
Expected: PASS — all pre-existing delegate tests still green (proves no behavior change), plus the new one.

- [ ] **Step 5: Commit**

```bash
git add src/core/delegate.ts tests/core/delegate.test.ts
git commit -m "refactor(core): extract runGuardedAgent shared by delegate tool"
```

---

## Task 4: Workflow telemetry spans

**Files:**
- Modify: `src/telemetry/spans.ts` (extend `ATTR`; add `withWorkflowSpan`, `withStepSpan`, `annotateStep`)
- Test: `tests/telemetry/workflow-spans.test.ts`

**Interfaces:**
- Consumes: existing private `inSpan` + `tracer()` in `spans.ts`; `trace` from `@opentelemetry/api` (mirror `recordGuardrailViolation`).
- Produces: `ATTR.WORKFLOW_ID/STEP_ID/STEP_KIND/STEP_BRANCH_TAKEN/STEP_MAP_COUNT/WORKFLOW_OUTCOME`; `withWorkflowSpan(workflowId, fn)`, `withStepSpan(stepId, kind, fn)`, `annotateStep(attrs)`.

- [ ] **Step 1: Write the failing test `tests/telemetry/workflow-spans.test.ts`**

```typescript
import { describe, expect, it } from 'bun:test';
import { registerTestProvider } from '../helpers/otel-test-provider.ts';
import {
  ATTR,
  annotateStep,
  withStepSpan,
  withWorkflowSpan,
} from '../../src/telemetry/spans.ts';

describe('workflow spans', () => {
  it('nests workflow.step under workflow.run with id/kind attrs', async () => {
    const { exporter } = registerTestProvider();
    await withWorkflowSpan('wf-demo', async () => {
      await withStepSpan('s1', 'agent', async () => {
        annotateStep({ [ATTR.STEP_MAP_COUNT]: 3 });
      });
    });
    const spans = exporter.getFinishedSpans();
    const run = spans.find((s) => s.name === 'workflow.run');
    const step = spans.find((s) => s.name === 'workflow.step');
    expect(run?.attributes[ATTR.WORKFLOW_ID]).toBe('wf-demo');
    expect(step?.attributes[ATTR.STEP_ID]).toBe('s1');
    expect(step?.attributes[ATTR.STEP_KIND]).toBe('agent');
    expect(step?.attributes[ATTR.STEP_MAP_COUNT]).toBe(3);
    expect(step?.parentSpanId).toBe(run?.spanContext().spanId);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/telemetry/workflow-spans.test.ts`
Expected: FAIL — exports not defined.

- [ ] **Step 3: Extend `src/telemetry/spans.ts`**

Add these keys to the existing `ATTR` object (before the closing `} as const;`):

```typescript
  WORKFLOW_ID: 'workflow.id',
  WORKFLOW_OUTCOME: 'workflow.outcome',
  STEP_ID: 'workflow.step.id',
  STEP_KIND: 'workflow.step.kind',
  STEP_BRANCH_TAKEN: 'workflow.step.branch.taken',
  STEP_MAP_COUNT: 'workflow.step.map.count',
```

Add the helpers (mirror `withDelegationSpan`/`recordGuardrailViolation`; `inSpan` is the existing private wrapper that starts an active span and ends it):

```typescript
/** Root span for a workflow run. Mirrors withRunSpan but for the DAG engine. */
export function withWorkflowSpan<T>(
  workflowId: string,
  fn: () => Promise<T>,
): Promise<T> {
  return inSpan('workflow.run', async (span) => {
    span.setAttribute(ATTR.WORKFLOW_ID, workflowId);
    return fn();
  });
}

/** Span for a single workflow step, tagged with its id + kind. */
export function withStepSpan<T>(
  stepId: string,
  kind: string,
  fn: () => Promise<T>,
): Promise<T> {
  return inSpan('workflow.step', async (span) => {
    span.setAttribute(ATTR.STEP_ID, stepId);
    span.setAttribute(ATTR.STEP_KIND, kind);
    return fn();
  });
}

/** Set extra attributes on the active step span (branch decision, map count). */
export function annotateStep(attrs: Record<string, string | number>): void {
  const span = trace.getActiveSpan();
  if (!span) return;
  for (const [k, v] of Object.entries(attrs)) span.setAttribute(k, v);
}
```

(Ensure `trace` is imported from `@opentelemetry/api` — it already is, used by `recordGuardrailViolation`.)

- [ ] **Step 4: Run tests + typecheck**

Run: `bun test tests/telemetry/workflow-spans.test.ts && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/telemetry/spans.ts tests/telemetry/workflow-spans.test.ts
git commit -m "feat(telemetry): workflow.run/workflow.step spans + annotateStep"
```

---

## Task 5: Per-kind step runners (`run-step.ts`)

**Files:**
- Create: `src/workflow/run-step.ts`
- Test: `tests/workflow/run-step.test.ts`

**Interfaces:**
- Consumes: `Step`, `StepKind`, `WorkflowContext`, `MapSubStep` (Task 1); `runGuardedAgent` + `Agent` (Task 3); `ToolSet` from `ai`; `ATTR`, `annotateStep` (Task 4); `WorkflowError`.
- Produces:
  - `type WorkflowDeps = { runAgentStep: (agentName: string, task: string) => Promise<string>; tools: ToolSet; maxParallel?: number }`
  - `function defaultRunAgentStep(agents: Record<string, Agent>): WorkflowDeps['runAgentStep']`
  - `function runStepByKind(step: Step, ctx: WorkflowContext, deps: WorkflowDeps): Promise<unknown>`
  - `const DEFAULT_MAX_PARALLEL: number` and `function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]>`

- [ ] **Step 1: Write the failing test `tests/workflow/run-step.test.ts`**

```typescript
import { describe, expect, it } from 'bun:test';
import { z } from 'zod';
import {
  DEFAULT_MAX_PARALLEL,
  type WorkflowDeps,
  runStepByKind,
} from '../../src/workflow/run-step.ts';
import { StepKind } from '../../src/workflow/types.ts';

const baseDeps = (over: Partial<WorkflowDeps> = {}): WorkflowDeps => ({
  runAgentStep: async (_a, task) => `ran:${task}`,
  tools: {},
  ...over,
});

describe('runStepByKind', () => {
  it('agent step calls runAgentStep with the built prompt', async () => {
    const out = await runStepByKind(
      {
        id: 's',
        kind: StepKind.Agent,
        agent: 'web_fetch',
        input: (ctx) => `task:${ctx.input}`,
        output: z.string(),
      },
      { input: 'X' },
      baseDeps(),
    );
    expect(out).toBe('ran:task:X');
  });

  it('tool step calls the tool execute with built args', async () => {
    const out = await runStepByKind(
      {
        id: 's',
        kind: StepKind.Tool,
        tool: 'echo',
        input: () => ({ msg: 'hi' }),
        output: z.object({ echoed: z.string() }),
      },
      {},
      baseDeps({
        tools: {
          echo: {
            description: 'echo',
            inputSchema: z.object({ msg: z.string() }),
            execute: async (args: { msg: string }) => ({ echoed: args.msg }),
          },
        } as unknown as WorkflowDeps['tools'],
      }),
    );
    expect(out).toEqual({ echoed: 'hi' });
  });

  it('branch step returns the taken arm', async () => {
    const out = await runStepByKind(
      {
        id: 'b',
        kind: StepKind.Branch,
        predicate: (ctx) => ctx.input === 'yes',
        whenTrue: 't',
        whenFalse: 'f',
        output: z.object({ taken: z.string() }),
      },
      { input: 'yes' },
      baseDeps(),
    );
    expect(out).toEqual({ taken: 'whenTrue' });
  });

  it('map step fans out over the list and collects results', async () => {
    const out = await runStepByKind(
      {
        id: 'm',
        kind: StepKind.Map,
        over: () => [1, 2, 3],
        step: {
          kind: StepKind.Agent,
          agent: 'web_fetch',
          input: (ctx) => `n=${ctx.item}`,
          output: z.string(),
        },
        output: z.array(z.string()),
      },
      {},
      baseDeps(),
    );
    expect(out).toEqual(['ran:n=1', 'ran:n=2', 'ran:n=3']);
  });

  it('exposes a conservative default concurrency cap', () => {
    expect(DEFAULT_MAX_PARALLEL).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/workflow/run-step.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/workflow/run-step.ts`**

```typescript
import type { ToolSet } from 'ai';
import type { Agent } from '../core/agent-def.ts';
import { runGuardedAgent } from '../core/delegate.ts';
import { WorkflowError } from '../core/errors.ts';
import { ATTR, annotateStep } from '../telemetry/spans.ts';
import {
  type MapSubStep,
  type Step,
  StepKind,
  type WorkflowContext,
} from './types.ts';

/** Conservative thrash-avoidance hint; the model manager's live-RAM budget is the
 *  real safety guard. Override per-map via `maxParallel` or via AGENT_WORKFLOW_MAX_PARALLEL. */
export const DEFAULT_MAX_PARALLEL = Number(
  process.env.AGENT_WORKFLOW_MAX_PARALLEL ?? 2,
);

export type WorkflowDeps = {
  /** Run a named agent with a task; returns its (already conciseness-capped) text.
   *  Default impl resolves from an agent map and goes through runGuardedAgent. */
  runAgentStep: (agentName: string, task: string) => Promise<string>;
  /** The mounted tool set (MCP + built-ins) tool steps call into. */
  tools: ToolSet;
  /** Engine-wide concurrency cap; defaults to DEFAULT_MAX_PARALLEL. */
  maxParallel?: number;
};

/** Default runAgentStep: resolve the agent by name, run it through the shared
 *  guarded path; a guard/agent error becomes a thrown WorkflowError (the engine
 *  then applies the step's onError policy). */
export function defaultRunAgentStep(
  agents: Record<string, Agent>,
): WorkflowDeps['runAgentStep'] {
  return async (agentName, task) => {
    const agent = agents[agentName];
    if (!agent) throw new WorkflowError(`unknown agent: ${agentName}`);
    const result = await runGuardedAgent(agent, task);
    if ('error' in result) throw new WorkflowError(result.error);
    return result.text;
  };
}

/** Bounded-concurrency map preserving input order. */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, i: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  const workers = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workers }, worker));
  return out;
}

async function runLeaf(
  sub: MapSubStep,
  ctx: WorkflowContext,
  deps: WorkflowDeps,
): Promise<unknown> {
  if (sub.kind === StepKind.Agent) {
    return deps.runAgentStep(sub.agent, sub.input(ctx));
  }
  const tool = deps.tools[sub.tool];
  if (!tool?.execute) throw new WorkflowError(`unknown tool: ${sub.tool}`);
  return (tool.execute as (a: unknown, o: unknown) => Promise<unknown>)(
    sub.input(ctx),
    { toolCallId: `map-leaf`, messages: [] },
  );
}

/** Dispatch a step to its kind runner. Returns the RAW result; the engine
 *  validates it against the step's output schema. */
export function runStepByKind(
  step: Step,
  ctx: WorkflowContext,
  deps: WorkflowDeps,
): Promise<unknown> {
  switch (step.kind) {
    case StepKind.Agent:
      return deps.runAgentStep(step.agent, step.input(ctx));
    case StepKind.Tool: {
      const tool = deps.tools[step.tool];
      if (!tool?.execute) {
        return Promise.reject(new WorkflowError(`unknown tool: ${step.tool}`));
      }
      return (tool.execute as (a: unknown, o: unknown) => Promise<unknown>)(
        step.input(ctx),
        { toolCallId: step.id, messages: [] },
      );
    }
    case StepKind.Branch: {
      const taken = step.predicate(ctx) ? 'whenTrue' : 'whenFalse';
      annotateStep({ [ATTR.STEP_BRANCH_TAKEN]: taken });
      return Promise.resolve({ taken });
    }
    case StepKind.Map: {
      const items = step.over(ctx);
      annotateStep({ [ATTR.STEP_MAP_COUNT]: items.length });
      const limit = step.maxParallel ?? deps.maxParallel ?? DEFAULT_MAX_PARALLEL;
      return mapWithConcurrency(items, limit, async (item, index) => {
        const subCtx: WorkflowContext = { ...ctx, item, index };
        const raw = await runLeaf(step.step, subCtx, deps);
        const parsed = step.step.output.safeParse(raw);
        if (!parsed.success) {
          throw new WorkflowError(
            `map ${step.id}[${index}] output invalid: ${parsed.error.message}`,
          );
        }
        return parsed.data;
      });
    }
  }
}
```

- [ ] **Step 4: Run tests + typecheck**

Run: `bun test tests/workflow/run-step.test.ts && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/workflow/run-step.ts tests/workflow/run-step.test.ts
git commit -m "feat(workflow): per-kind step runners with bounded map fan-out"
```

---

## Task 6: The executor (`engine.ts`)

**Files:**
- Create: `src/workflow/engine.ts`
- Test: `tests/workflow/engine.test.ts`

**Interfaces:**
- Consumes: `WorkflowDef`, `Step`, `StepKind`, `WorkflowContext`, `WorkflowOutcome`, `effectiveDeps` (Task 1); `WorkflowDeps`, `runStepByKind`, `DEFAULT_MAX_PARALLEL` (Task 5); `withStepSpan` (Task 4); `WorkflowError`.
- Produces: `function runWorkflow(def: WorkflowDef, input: unknown, deps: WorkflowDeps): Promise<WorkflowOutcome>`. Re-exports `defaultRunAgentStep` for the CLI convenience.

- [ ] **Step 1: Write the failing test `tests/workflow/engine.test.ts`**

```typescript
import { describe, expect, it } from 'bun:test';
import { z } from 'zod';
import { defineWorkflow } from '../../src/workflow/define.ts';
import { runWorkflow } from '../../src/workflow/engine.ts';
import type { WorkflowDeps } from '../../src/workflow/run-step.ts';
import { StepKind } from '../../src/workflow/types.ts';

const deps = (over: Partial<WorkflowDeps> = {}): WorkflowDeps => ({
  runAgentStep: async (_a, task) => task.toUpperCase(),
  tools: {},
  ...over,
});

describe('runWorkflow', () => {
  it('threads validated context through a linear chain', async () => {
    const def = defineWorkflow({
      id: 'chain',
      steps: [
        {
          id: 'a',
          kind: StepKind.Agent,
          agent: 'x',
          input: (ctx) => `hello ${ctx.input}`,
          output: z.string(),
        },
        {
          id: 'b',
          kind: StepKind.Agent,
          agent: 'x',
          input: (ctx) => `again ${ctx.a}`,
          output: z.string(),
        },
      ],
    });
    const out = await runWorkflow(def, 'world', deps());
    expect(out.kind).toBe('done');
    if (out.kind === 'done') {
      expect(out.output.a).toBe('HELLO WORLD');
      expect(out.output.b).toBe('AGAIN HELLO WORLD');
    }
  });

  it('fails the workflow when output schema validation fails', async () => {
    const def = defineWorkflow({
      id: 'badout',
      steps: [
        {
          id: 'a',
          kind: StepKind.Agent,
          agent: 'x',
          input: () => 'text',
          output: z.number(), // agent returns a string → invalid
        },
      ],
    });
    const out = await runWorkflow(def, null, deps());
    expect(out).toMatchObject({ kind: 'failed', failedStep: 'a' });
  });

  it('branch takes the correct arm and skips the dead arm + its descendants', async () => {
    const def = defineWorkflow({
      id: 'br',
      steps: [
        {
          id: 'gate',
          kind: StepKind.Branch,
          dependsOn: [],
          predicate: (ctx) => ctx.input === 'go',
          whenTrue: 'live',
          whenFalse: 'dead',
          output: z.object({ taken: z.string() }),
        },
        {
          id: 'live',
          kind: StepKind.Agent,
          agent: 'x',
          dependsOn: ['gate'],
          input: () => 'live',
          output: z.string(),
        },
        {
          id: 'dead',
          kind: StepKind.Agent,
          agent: 'x',
          dependsOn: ['gate'],
          input: () => 'dead',
          output: z.string(),
        },
      ],
    });
    const out = await runWorkflow(def, 'go', deps());
    expect(out.kind).toBe('done');
    if (out.kind === 'done') {
      expect(out.output.live).toBe('LIVE');
      expect('dead' in out.output).toBe(false);
    }
  });

  it('onError "continue" skips dependents; {fallback} substitutes', async () => {
    const failingDeps = deps({
      runAgentStep: async (_a, task) => {
        if (task === 'boom') throw new Error('kaboom');
        return task;
      },
    });
    const def = defineWorkflow({
      id: 'resil',
      steps: [
        {
          id: 'a',
          kind: StepKind.Agent,
          agent: 'x',
          input: () => 'boom',
          output: z.string(),
          onError: { fallback: 'SAFE' },
        },
        {
          id: 'b',
          kind: StepKind.Agent,
          agent: 'x',
          input: (ctx) => `got ${ctx.a}`,
          output: z.string(),
        },
      ],
    });
    const out = await runWorkflow(def, null, failingDeps);
    expect(out.kind).toBe('done');
    if (out.kind === 'done') {
      expect(out.output.a).toBe('SAFE');
      expect(out.output.b).toBe('got SAFE');
    }
  });

  it('map fans out and collects validated results', async () => {
    const def = defineWorkflow({
      id: 'mapwf',
      steps: [
        {
          id: 'm',
          kind: StepKind.Map,
          dependsOn: [],
          over: (ctx) => ctx.input as string[],
          step: {
            kind: StepKind.Agent,
            agent: 'x',
            input: (ctx) => String(ctx.item),
            output: z.string(),
          },
          output: z.array(z.string()),
        },
      ],
    });
    const out = await runWorkflow(def, ['a', 'b'], deps());
    expect(out.kind).toBe('done');
    if (out.kind === 'done') expect(out.output.m).toEqual(['A', 'B']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/workflow/engine.test.ts`
Expected: FAIL — `runWorkflow` not defined.

- [ ] **Step 3: Write `src/workflow/engine.ts`**

```typescript
import { withStepSpan } from '../telemetry/spans.ts';
import {
  type WorkflowDeps,
  DEFAULT_MAX_PARALLEL,
  runStepByKind,
} from './run-step.ts';
import {
  type Step,
  StepKind,
  type WorkflowContext,
  type WorkflowDef,
  type WorkflowOutcome,
  effectiveDeps,
} from './types.ts';

export { defaultRunAgentStep } from './run-step.ts';
export type { WorkflowDeps } from './run-step.ts';

type StepResult =
  | { step: Step; value: unknown }
  | { step: Step; error: Error };

/** Execute a workflow DAG: topological scheduling with bounded concurrency,
 *  per-step zod output validation, per-step onError policy, and branch skipping. */
export async function runWorkflow(
  def: WorkflowDef,
  input: unknown,
  deps: WorkflowDeps,
): Promise<WorkflowOutcome> {
  const maxParallel = deps.maxParallel ?? DEFAULT_MAX_PARALLEL;
  const ctx: WorkflowContext = { input };
  const steps = def.steps;
  const done = new Set<string>();
  const skipped = new Set<string>();

  const isReady = (step: Step, i: number): boolean => {
    if (done.has(step.id) || skipped.has(step.id)) return false;
    const d = effectiveDeps(step, i, steps);
    if (d.some((id) => skipped.has(id))) {
      skipped.add(step.id); // dead-arm / continue propagation
      return false;
    }
    return d.every((id) => done.has(id));
  };

  let failure: WorkflowOutcome | null = null;
  while (!failure) {
    const batch = steps.filter((s, i) => isReady(s, i)).slice(0, maxParallel);
    if (batch.length === 0) break; // nothing runnable → done or fully skipped

    const results: StepResult[] = await Promise.all(
      batch.map(async (step): Promise<StepResult> => {
        try {
          const raw = await withStepSpan(step.id, step.kind, () =>
            runStepByKind(step, ctx, deps),
          );
          const parsed = step.output.safeParse(raw);
          if (!parsed.success) {
            throw new Error(
              `step ${step.id} output failed validation: ${parsed.error.message}`,
            );
          }
          return { step, value: parsed.data };
        } catch (cause) {
          return { step, error: cause as Error };
        }
      }),
    );

    for (const r of results) {
      if ('error' in r) {
        const policy = r.step.onError ?? 'fail';
        if (policy === 'fail') {
          failure = {
            kind: 'failed',
            failedStep: r.step.id,
            message: r.error.message,
          };
        } else if (policy === 'continue') {
          skipped.add(r.step.id);
        } else {
          ctx[r.step.id] = policy.fallback;
          done.add(r.step.id);
        }
        continue;
      }
      ctx[r.step.id] = r.value;
      done.add(r.step.id);
      if (r.step.kind === StepKind.Branch) {
        const taken = (r.value as { taken: string }).taken;
        const dead = taken === 'whenTrue' ? r.step.whenFalse : r.step.whenTrue;
        skipped.add(dead);
      }
    }
  }

  if (failure) return failure;
  return { kind: 'done', output: ctx };
}
```

- [ ] **Step 4: Run tests + typecheck**

Run: `bun test tests/workflow/engine.test.ts && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/workflow/engine.ts tests/workflow/engine.test.ts
git commit -m "feat(workflow): topological executor with onError + branch skipping"
```

---

## Task 7: CLI entry (`flow.ts`), registry, and example workflow

**Files:**
- Create: `src/cli/flow.ts`, `workflows/index.ts`, `workflows/fetch-then-summarize.ts`
- Modify: `package.json` (add `flow` script)
- Test: `tests/cli/flow.test.ts`, `tests/integration/workflow.live.test.ts`

**Interfaces:**
- Consumes: `runWorkflow`, `defaultRunAgentStep` (Task 6); `withWorkflowSpan` + `ATTR.WORKFLOW_OUTCOME` + `annotateStep` (Task 4); `createRun`/`writeArtifact` (`src/run/run-store.ts`); `initRunTelemetry` (`src/telemetry/provider.ts`); `createFileTools`/`createFetchTools` (`src/mcp/client.ts`); `createFileQaAgent`/`createWebFetchAgent` (`agents/`); `defineWorkflow`.
- Produces:
  - `workflows/index.ts`: `export const WORKFLOWS: Record<string, WorkflowDef>` and `export function getWorkflow(name: string): WorkflowDef | undefined`.
  - `src/cli/flow.ts`: `export async function runFlow(deps: FlowDeps): Promise<WorkflowOutcome>` where `FlowDeps = { def: WorkflowDef; input: unknown; runsRoot: string; runId: string; agents: Record<string, Agent>; tools: ToolSet }`, plus a `main()`.

- [ ] **Step 1: Write the example `workflows/fetch-then-summarize.ts`**

```typescript
import { z } from 'zod';
import { defineWorkflow } from '../src/workflow/define.ts';
import { StepKind } from '../src/workflow/types.ts';

/** tool(fetch) → agent(summarize): fetch a URL's content, then summarize it.
 *  The workflow input is the URL string. */
export default defineWorkflow({
  id: 'fetch-then-summarize',
  description: 'Fetch a URL with the fetch tool, then summarize via an agent.',
  steps: [
    {
      id: 'fetch',
      kind: StepKind.Tool,
      dependsOn: [],
      tool: 'fetch', // provided by mcp-server-fetch
      input: (ctx) => ({ url: String(ctx.input) }),
      output: z.unknown(),
    },
    {
      id: 'summarize',
      kind: StepKind.Agent,
      dependsOn: ['fetch'],
      agent: 'web_fetch',
      input: (ctx) =>
        `Summarize the following web page content in 3 concise bullet points:\n\n${JSON.stringify(ctx.fetch).slice(0, 8000)}`,
      output: z.string(),
    },
  ],
});
```

- [ ] **Step 2: Write the registry `workflows/index.ts`**

```typescript
import type { WorkflowDef } from '../src/workflow/types.ts';
import fetchThenSummarize from './fetch-then-summarize.ts';

/** name → workflow definition (mirrors models/registry.ts). */
export const WORKFLOWS: Record<string, WorkflowDef> = {
  [fetchThenSummarize.id]: fetchThenSummarize,
};

export function getWorkflow(name: string): WorkflowDef | undefined {
  return WORKFLOWS[name];
}
```

- [ ] **Step 3: Write the failing test `tests/cli/flow.test.ts`**

```typescript
import { describe, expect, it } from 'bun:test';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MockLanguageModelV3 } from 'ai/test';
import { z } from 'zod';
import { runFlow } from '../../src/cli/flow.ts';
import { defineWorkflow } from '../../src/workflow/define.ts';
import { StepKind } from '../../src/workflow/types.ts';

const cannedAgent = (name: string) => ({
  name,
  description: name,
  model: new MockLanguageModelV3({
    doGenerate: async () => ({
      content: [{ type: 'text', text: 'summary text' }],
      finishReason: { unified: 'stop', raw: undefined },
      usage: {
        inputTokens: { total: 1, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 1, text: undefined, reasoning: undefined },
      },
      warnings: [],
    }),
  }),
  systemPrompt: 'x',
  tools: {},
});

describe('runFlow', () => {
  it('writes spans.jsonl with workflow spans + result.txt on success', async () => {
    const runsRoot = await mkdtemp(join(tmpdir(), 'flow-'));
    const def = defineWorkflow({
      id: 'demo',
      steps: [
        {
          id: 'sum',
          kind: StepKind.Agent,
          agent: 'web_fetch',
          input: () => 'do it',
          output: z.string(),
        },
      ],
    });
    const outcome = await runFlow({
      def,
      input: 'hello',
      runsRoot,
      runId: 'r1',
      agents: { web_fetch: cannedAgent('web_fetch') },
      tools: {},
    });
    expect(outcome.kind).toBe('done');
    const spans = await readFile(join(runsRoot, 'r1', 'spans.jsonl'), 'utf8');
    expect(spans).toContain('workflow.run');
    expect(spans).toContain('workflow.step');
    const result = await readFile(join(runsRoot, 'r1', 'result.txt'), 'utf8');
    expect(result).toContain('summary text');
  });

  it('writes failed.txt and returns failed on a failing step', async () => {
    const runsRoot = await mkdtemp(join(tmpdir(), 'flow-'));
    const def = defineWorkflow({
      id: 'demo',
      steps: [
        {
          id: 'sum',
          kind: StepKind.Agent,
          agent: 'web_fetch',
          input: () => 'do it',
          output: z.number(), // string result → validation failure
        },
      ],
    });
    const outcome = await runFlow({
      def,
      input: null,
      runsRoot,
      runId: 'r2',
      agents: { web_fetch: cannedAgent('web_fetch') },
      tools: {},
    });
    expect(outcome.kind).toBe('failed');
    const failed = await readFile(join(runsRoot, 'r2', 'failed.txt'), 'utf8');
    expect(failed).toContain('sum');
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `bun test tests/cli/flow.test.ts`
Expected: FAIL — `runFlow` not defined.

- [ ] **Step 5: Write `src/cli/flow.ts`**

```typescript
import type { ToolSet } from 'ai';
import { createFileQaAgent } from '../../agents/file-qa.ts';
import { createWebFetchAgent } from '../../agents/web-fetch.ts';
import { getWorkflow } from '../../workflows/index.ts';
import type { Agent } from '../core/agent-def.ts';
import { createFetchTools, createFileTools } from '../mcp/client.ts';
import { createRun, writeArtifact } from '../run/run-store.ts';
import { initRunTelemetry } from '../telemetry/provider.ts';
import { ATTR, annotateStep, withWorkflowSpan } from '../telemetry/spans.ts';
import { defaultRunAgentStep, runWorkflow } from '../workflow/engine.ts';
import type { WorkflowDef, WorkflowOutcome } from '../workflow/types.ts';

export type FlowDeps = {
  def: WorkflowDef;
  input: unknown;
  runsRoot: string;
  runId: string;
  agents: Record<string, Agent>;
  tools: ToolSet;
};

/** Run a workflow with telemetry + artifact persistence (mirrors runChat). */
export async function runFlow(deps: FlowDeps): Promise<WorkflowOutcome> {
  const run = await createRun(deps.runsRoot, deps.runId);
  const tel = initRunTelemetry(run.dir);
  try {
    const outcome = await withWorkflowSpan(deps.def.id, () =>
      runWorkflow(deps.def, deps.input, {
        runAgentStep: defaultRunAgentStep(deps.agents),
        tools: deps.tools,
      }),
    );
    if (outcome.kind === 'done') {
      const last = deps.def.steps[deps.def.steps.length - 1].id;
      const value = outcome.output[last];
      const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
      await writeArtifact(run, 'result.txt', text);
    } else {
      await writeArtifact(
        run,
        'failed.txt',
        `step ${outcome.failedStep}: ${outcome.message}`,
      );
    }
    return outcome;
  } finally {
    await tel.shutdown();
  }
}

async function main(): Promise<void> {
  const [name, ...rest] = process.argv.slice(2);
  if (!name) {
    console.error('Usage: bun run flow <name> [input...]');
    process.exit(1);
  }
  const def = getWorkflow(name);
  if (!def) {
    console.error(`Unknown workflow: ${name}`);
    process.exit(1);
  }

  const fileServer = await createFileTools();
  try {
    const fetchServer = await createFetchTools();
    try {
      const tools: ToolSet = { ...fileServer.tools, ...fetchServer.tools };
      const agents: Record<string, Agent> = {};
      const fileQa = createFileQaAgent(fileServer.tools);
      const webFetch = createWebFetchAgent(fetchServer.tools);
      agents[fileQa.name] = fileQa;
      agents[webFetch.name] = webFetch;

      const outcome = await runFlow({
        def,
        input: rest.join(' ').trim(),
        runsRoot: 'runs',
        runId: `flow-${process.pid}`,
        agents,
        tools,
      });
      if (outcome.kind === 'done') {
        const last = def.steps[def.steps.length - 1].id;
        const value = outcome.output[last];
        console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 2));
      } else {
        console.error(`Workflow failed at ${outcome.failedStep}: ${outcome.message}`);
        process.exitCode = 1;
      }
    } finally {
      await fetchServer.close();
    }
  } finally {
    await fileServer.close();
  }
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
```

(Note: `annotateStep`/`ATTR` are imported because the engine sets `ATTR.WORKFLOW_OUTCOME` — if you prefer, set it inside `runFlow` via `annotateStep({ [ATTR.WORKFLOW_OUTCOME]: outcome.kind })` right after `runWorkflow` resolves, while still inside `withWorkflowSpan`. To do that, move the artifact-writing into the `withWorkflowSpan` callback. Keep it simple: the import is used either way.)

- [ ] **Step 6: Add the `flow` script to `package.json`**

In `scripts`, after `"discover"`:

```json
    "flow": "bun run src/cli/flow.ts",
```

- [ ] **Step 7: Write the live integration test `tests/integration/workflow.live.test.ts`**

```typescript
import { describe, expect, it } from 'bun:test';
import { isOllamaUp } from '../helpers/ollama-up.ts'; // reuse existing live-skip helper

const live = await isOllamaUp();
const maybe = live ? it : it.skip;

describe('workflow.live', () => {
  maybe(
    'runs fetch-then-summarize end-to-end against real Ollama',
    async () => {
      const { runFlow } = await import('../../src/cli/flow.ts');
      const { getWorkflow } = await import('../../workflows/index.ts');
      const { createFetchTools, createFileTools } = await import(
        '../../src/mcp/client.ts'
      );
      const { createFileQaAgent } = await import('../../agents/file-qa.ts');
      const { createWebFetchAgent } = await import('../../agents/web-fetch.ts');
      const { mkdtemp } = await import('node:fs/promises');
      const { tmpdir } = await import('node:os');
      const { join } = await import('node:path');

      const def = getWorkflow('fetch-then-summarize');
      expect(def).toBeDefined();
      const fileServer = await createFileTools();
      const fetchServer = await createFetchTools();
      try {
        const runsRoot = await mkdtemp(join(tmpdir(), 'flowlive-'));
        const fileQa = createFileQaAgent(fileServer.tools);
        const webFetch = createWebFetchAgent(fetchServer.tools);
        const outcome = await runFlow({
          def: def!,
          input: 'https://example.com',
          runsRoot,
          runId: 'live',
          agents: { [fileQa.name]: fileQa, [webFetch.name]: webFetch },
          tools: { ...fileServer.tools, ...fetchServer.tools },
        });
        expect(outcome.kind).toBe('done');
      } finally {
        await fetchServer.close();
        await fileServer.close();
      }
    },
    120_000,
  );
});
```

(If `tests/helpers/ollama-up.ts` does not exist, mirror the live-skip guard used by the existing `*.live.test.ts` files — check how `orchestrator.live`/`model-manager.live` decide to skip and copy that exact predicate.)

- [ ] **Step 8: Run tests + typecheck + lint**

Run: `bun test tests/cli/flow.test.ts && bun run typecheck && bun run lint:file -- "src/cli/flow.ts" "workflows/*.ts"`
Expected: unit test PASS; live test skips when Ollama is down; typecheck + lint clean.

- [ ] **Step 9: Commit**

```bash
git add src/cli/flow.ts workflows/ package.json tests/cli/flow.test.ts tests/integration/workflow.live.test.ts
git commit -m "feat(workflow): bun run flow CLI + registry + fetch-then-summarize example"
```

---

## Task 8: Architecture doc — Workflow engine section (docs hard line)

**Files:**
- Modify: `docs/architecture.md` (add §12; update the §2 module map + dependency table to include `src/workflow/*` and the `runs/` data-flow edge)

**Interfaces:** none (docs). This task is REQUIRED for `bun run docs:check` to pass (pre-commit hook gates on every `src/<subsystem>` being documented).

- [ ] **Step 1: Add a "§12. Workflow engine" section to `docs/architecture.md`**

Insert after the Glossary section (or as a numbered section in sequence). Content must accurately describe the code as built:

```markdown
## 12. Workflow engine

A second, **deterministic** orchestration mode beside the LLM router. A workflow is a
typed, JSON-serializable DAG built with `defineWorkflow({ id, steps })` (`src/workflow/define.ts`),
validated at construction (unique ids · resolvable deps + branch targets · acyclic).

**Step kinds** (`src/workflow/types.ts`, `StepKind`): `agent` · `tool` · `branch` · `map`.
Each step declares a **zod `output` schema**; the engine validates the step result with
`safeParse` and stores it in a `WorkflowContext` keyed by step id. Data flows between steps
through typed `input: (ctx) => …` mappers (deps are declared, never inferred from `input`).

**Execution** (`src/workflow/engine.ts`, `runWorkflow(def, input, deps)`): topological
scheduling with bounded concurrency (default conservative, `AGENT_WORKFLOW_MAX_PARALLEL` /
per-`map` `maxParallel` override; the model-manager live-RAM budget is the real guard).
Default deps `dependsOn` = previous step in declaration order. **Fail-fast** by default;
per-step `onError: 'continue' | { fallback }`. A `branch` selects one arm and skips the
dead arm + its exclusive descendants (no fan-in join in v1).

**Agent steps reuse Slice-9 guardrails**: the per-kind runners (`src/workflow/run-step.ts`)
invoke `runGuardedAgent` (extracted from `src/core/delegate.ts` — shared by the orchestrator's
delegate tool and the engine), so depth + return-cap + `agent.delegation` spans apply identically.

**Entry**: `bun run flow <name> [input...]` (`src/cli/flow.ts`) over the `workflows/` registry;
mounts the same MCP tools `chat.ts` does. A run writes `runs/<id>/spans.jsonl` + `result.txt`
(or `failed.txt`) — rendered by `bun run runs <id>`.

**Telemetry** (`src/telemetry/spans.ts`): root `workflow.run` span (`ATTR.WORKFLOW_ID`) →
per-step `workflow.step` spans (`ATTR.STEP_ID`, `STEP_KIND`, `STEP_BRANCH_TAKEN`, `STEP_MAP_COUNT`)
→ nested `agent.delegation`.

Feeds Slice 11 (crews/roles), Slice 12 (RAG retrieval step), Slice 13 (verifier step).
Out of scope (v1): JSON/YAML loader + visual editor (shape is serializable), durable/resumable
runs (Phase E — align with AI SDK 7 `WorkflowAgent` then), branch fan-in joins, streaming step output.
```

- [ ] **Step 2: Update the §2 module map + dependency table**

Add `src/workflow/` (types, define, engine, run-step) as a module box and its edges:
`src/cli/flow.ts → src/workflow/engine.ts → src/workflow/run-step.ts → src/core/delegate.ts (runGuardedAgent)`;
`src/workflow/* → src/telemetry/spans.ts`; `flow.ts → src/run/run-store.ts + src/mcp/client.ts + agents/`.
Match the exact Mermaid/table style already in the file (read the existing §2 blocks first and follow their format precisely — do not invent a new style).

- [ ] **Step 3: Run docs-check + full gate**

Run: `bun run docs:check && bun run typecheck && bun run lint && bun test`
Expected: docs-check PASS (workflow subsystem documented); typecheck + lint clean; full suite green (live tests skip if Ollama down).

- [ ] **Step 4: Commit**

```bash
git add docs/architecture.md
git commit -m "docs(slice-10): document the workflow engine in architecture.md"
```

---

## Final verification (before PR)

- [ ] `bun run check` (docs-check · typecheck · lint · test) is GREEN.
- [ ] `bun run serve` then `bun run flow fetch-then-summarize https://example.com` runs end-to-end and writes `runs/<id>/spans.jsonl` + `result.txt`.
- [ ] `bun run runs <id>` shows `workflow.run → workflow.step → agent.delegation`.
- [ ] Existing orchestrator/delegate tests still pass (the `runGuardedAgent` extract caused no behavior change).
- [ ] Refresh `resume-here.md` with the merge state.

---

## Self-review notes (plan author)

**Spec coverage:** §2.1 types → Task 1; §2.2 define → Task 2; §2.6 runGuardedAgent extract → Task 3; §2.7 spans → Task 4; §2.4 run-step → Task 5; §2.3 engine → Task 6; §2.5 CLI+registry → Task 7; §8 docs → Task 8. §5 testing covered across Tasks 1–7 (unit) + Task 7 (live). §4 determinism = engine `onError` + acyclic `define` + bounded `map`. §7 acceptance = Final verification.

**Latest-internet validation (standing rule [[prefers-latest-methodology]]):** confirmed the deterministic-DAG approach is correct vs AI SDK 6/7 (their native agent loop = the *model-driven* mode we already have; their durable Workflow SDK is Phase-E and infra-coupled). Refinements folded in: zod **`safeParse`** (not `parse`) for step validation; durable/resumable later should align with AI SDK 7 `WorkflowAgent`.

**Type consistency:** `runGuardedAgent` signature identical in Task 3 (definition) and Task 5 (consumer). `WorkflowDeps`/`runStepByKind`/`DEFAULT_MAX_PARALLEL` defined in Task 5, consumed in Task 6/7. `effectiveDeps` defined in Task 1, used in Task 2 + Task 6. `withStepSpan`/`withWorkflowSpan`/`annotateStep`/`ATTR.*` defined Task 4, used Task 5/6/7.

**Known v1 simplifications (documented, deferred):** wave-based bounded concurrency (whole batch awaited per wave — fine for v1); no branch fan-in join; `{fallback}` value is used directly (author's typed escape hatch, not re-validated); concurrency cap is a hint (model-manager live budget is the real guard).
