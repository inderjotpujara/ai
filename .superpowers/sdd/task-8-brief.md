### Task 8: two-tier validation (`validate.ts`)

**Files:**
- Create: `src/crew-builder/validate.ts`
- Test: `tests/crew-builder/validate.test.ts`

**Interfaces:**
- Consumes: `CrewIR`/`WorkflowIR`, `ValidationIssue` (`src/agent-builder/types.ts`), `BuilderModel`, `defineCrew`/`defineWorkflow` for the structural gate, `AGENTS` names + pack names via params.
- Produces: `validateIR(ir, shape, ctx): Promise<ValidationIssue[]>` where `ctx = { existingAgents, packNames, toBeBuilt, model }`. Runs structural (sync) then semantic (async). Empty array = valid.

- [ ] **Step 1: Write the failing test**

```ts
// tests/crew-builder/validate.test.ts
import { expect, test } from 'bun:test';
import type { BuilderModel } from '../../src/agent-builder/types.ts';
import { validateIR } from '../../src/crew-builder/validate.ts';
import type { WorkflowIR } from '../../src/crew-builder/ir.ts';

const okJudge: BuilderModel = { object: async () => ({ aligned: true, reason: 'ok' } as never), text: async () => '' };

test('flags a fromStep ref that names no upstream step (structural)', async () => {
  const ir: WorkflowIR = { id: 'w', steps: [
    { kind: 'agent', id: 'a', agent: 'web_fetch', input: { kind: 'fromStep', ref: 'ghost' } },
  ] };
  const issues = await validateIR(ir, 'workflow', { existingAgents: ['web_fetch'], packNames: [], toBeBuilt: [], model: okJudge });
  expect(issues.some((i) => i.problem.includes('ghost'))).toBe(true);
});

test('flags an agent step referencing an unknown agent', async () => {
  const ir: WorkflowIR = { id: 'w', steps: [
    { kind: 'agent', id: 'a', agent: 'nope', input: { kind: 'fromInput' } },
  ] };
  const issues = await validateIR(ir, 'workflow', { existingAgents: ['web_fetch'], packNames: [], toBeBuilt: [], model: okJudge });
  expect(issues.some((i) => i.field === 'agent')).toBe(true);
});

test('passes a valid workflow (agent known, ref resolves, goal aligned)', async () => {
  const ir: WorkflowIR = { id: 'w', steps: [
    { kind: 'tool', id: 'f', tool: 'fetch', input: { kind: 'fromInput' } },
    { kind: 'agent', id: 'a', agent: 'web_fetch', dependsOn: ['f'], input: { kind: 'fromStep', ref: 'f' } },
  ] };
  const issues = await validateIR(ir, 'workflow', { existingAgents: ['web_fetch'], packNames: ['fetch'], toBeBuilt: [], model: okJudge });
  expect(issues).toEqual([]);
});

test('surfaces a goal-misaligned graph (semantic tier)', async () => {
  const noJudge: BuilderModel = { object: async () => ({ aligned: false, reason: 'does not answer the need' } as never), text: async () => '' };
  const ir: WorkflowIR = { id: 'w', steps: [{ kind: 'agent', id: 'a', agent: 'web_fetch', input: { kind: 'fromInput' } }] };
  const issues = await validateIR(ir, 'workflow', { existingAgents: ['web_fetch'], packNames: [], toBeBuilt: [], model: noJudge });
  expect(issues.some((i) => i.field === 'goal-alignment')).toBe(true);
});
```

- [ ] **Step 2: Run — FAIL.**

- [ ] **Step 3: Implement** — structural first (reuse `defineWorkflow`/`defineCrew` for acyclicity via try/catch + explicit ref checks), then the LLM-judge goal-alignment. `toBeBuilt` = agent names that WILL be built this run (so a reference to a to-be-built agent is valid).

```ts
// src/crew-builder/validate.ts
import { z } from 'zod';
import type { BuilderModel, ValidationIssue } from '../agent-builder/types.ts';
import { defineCrew } from '../crew/define.ts';
import { CrewProcess, type CrewDef } from '../crew/types.ts';
import { defineWorkflow } from '../workflow/define.ts';
import type { CrewIR, WorkflowIR } from './ir.ts';
import type { Shape } from './types.ts';

export type ValidateCtx = {
  existingAgents: string[]; packNames: string[]; toBeBuilt: string[]; model: BuilderModel;
};

const AlignSchema = z.object({ aligned: z.boolean(), reason: z.string() });

/** Collect every input/predicate/map ref in a workflow step. */
function refsOf(step: WorkflowIR['steps'][number]): string[] {
  const out: string[] = [];
  if ('input' in step && step.input.kind === 'fromStep') out.push(step.input.ref);
  if (step.kind === 'branch') out.push(step.predicate.ref);
  if (step.kind === 'map') {
    out.push(step.over.ref);
    if (step.step.input.kind === 'fromStep') out.push(step.step.input.ref);
  }
  return out;
}

function structuralWorkflow(ir: WorkflowIR, ctx: ValidateCtx): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const ids = new Set(ir.steps.map((s) => s.id));
  const known = new Set([...ctx.existingAgents, ...ctx.toBeBuilt]);
  for (const step of ir.steps) {
    if (step.kind === 'agent' && !known.has(step.agent)) {
      issues.push({ field: 'agent', problem: `step ${step.id} references unknown agent "${step.agent}"` });
    }
    if (step.kind === 'tool' && !ctx.packNames.includes(step.tool)) {
      issues.push({ field: 'tool', problem: `step ${step.id} uses tool "${step.tool}" not in the palette` });
    }
    for (const ref of refsOf(step)) {
      if (!ids.has(ref)) issues.push({ field: 'ref', problem: `step ${step.id} references unknown step "${ref}"` });
    }
    if (step.kind === 'branch') {
      for (const t of [step.whenTrue, step.whenFalse]) {
        if (!ids.has(t)) issues.push({ field: 'branch', problem: `branch ${step.id} target "${t}" is unknown` });
      }
    }
  }
  return issues;
}

function structuralCrew(ir: CrewIR, ctx: ValidateCtx): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const known = new Set([...ctx.existingAgents, ...ctx.toBeBuilt]);
  for (const m of ir.members) {
    if (m.agentRef && !known.has(m.agentRef)) {
      issues.push({ field: 'agentRef', problem: `member ${m.name} references unknown agent "${m.agentRef}"` });
    }
    for (const t of m.tools ?? []) {
      if (!ctx.packNames.includes(t)) issues.push({ field: 'tools', problem: `member ${m.name} tool "${t}" not in the palette` });
    }
  }
  return issues;
}

async function goalAlignment(need: string, ir: unknown, model: BuilderModel): Promise<ValidationIssue[]> {
  const prompt = [
    'Does the plan below actually accomplish the stated need? Answer JSON { "aligned": boolean, "reason": string }.',
    `Need: ${need}`, `Plan: ${JSON.stringify(ir)}`,
  ].join('\n');
  const { aligned, reason } = await model.object({ schema: AlignSchema, prompt });
  return aligned ? [] : [{ field: 'goal-alignment', problem: reason || 'graph does not accomplish the need' }];
}

/** Two-tier gate: structural (acyclicity via define* + ref/agent/tool checks) then semantic (goal-alignment). */
export async function validateIR(
  ir: CrewIR | WorkflowIR, shape: Shape, ctx: ValidateCtx, need = '',
): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  if (shape === 'workflow') {
    issues.push(...structuralWorkflow(ir as WorkflowIR, ctx));
    try {
      // acyclicity + id-uniqueness + dep resolution (closures are stubbed; we only need the graph checks)
      defineWorkflow({ id: ir.id, steps: (ir as WorkflowIR).steps.map((s) => ({
        id: s.id, kind: s.kind as never, dependsOn: 'dependsOn' in s ? s.dependsOn : undefined,
        // minimal stubs so the validator's graph checks run:
        ...(s.kind === 'agent' ? { agent: (s as { agent: string }).agent, input: () => '' } : {}),
        ...(s.kind === 'tool' ? { tool: (s as { tool: string }).tool, input: () => ({}) } : {}),
        ...(s.kind === 'branch' ? { predicate: () => true, whenTrue: (s as { whenTrue: string }).whenTrue, whenFalse: (s as { whenFalse: string }).whenFalse } : {}),
        ...(s.kind === 'map' ? { over: () => [], step: { kind: 'agent', agent: 'x', input: () => '', output: undefined as never } } : {}),
        output: undefined as never,
      })) as never });
    } catch (e) {
      issues.push({ field: 'graph', problem: (e as Error).message });
    }
  } else {
    issues.push(...structuralCrew(ir as CrewIR, ctx));
    try {
      const crew: CrewDef = {
        id: ir.id, process: (ir as CrewIR).process === 'hierarchical' ? CrewProcess.Hierarchical : CrewProcess.Sequential,
        members: (ir as CrewIR).members.map((m) => ({ name: m.name, role: m.role, goal: m.goal, backstory: m.backstory, requires: [] as never, prefer: 'largest-that-fits' as never })),
        tasks: (ir as CrewIR).tasks.map((t) => ({ id: t.id, description: t.description, expectedOutput: t.expectedOutput, member: t.member, dependsOn: t.dependsOn })),
      };
      defineCrew(crew);
    } catch (e) {
      issues.push({ field: 'graph', problem: (e as Error).message });
    }
  }
  if (issues.length > 0) return issues; // don't spend a model call on a structurally-broken graph
  return goalAlignment(need, ir, ctx.model);
}
```

> NOTE for implementer: the `defineWorkflow`/`defineCrew` stub-mapping above exists ONLY to reuse their Kahn acyclicity + id/dep checks without building real closures. If mapping to the exact `Step`/`CrewMember` types proves noisy, extract the pure graph checks (`effectiveDeps` + Kahn) into a shared `assertAcyclic(ids, edges)` helper in `src/workflow/define.ts` and call it directly from both `defineWorkflow` and here (DRY). Prefer the shared helper if the stub casts get ugly — decide during implementation, keep it typechecking-clean with no `any`.

- [ ] **Step 4: Run — PASS** (`bun test tests/crew-builder/validate.test.ts && bun run typecheck`).

- [ ] **Step 5: Commit**

```bash
git add src/crew-builder/validate.ts tests/crew-builder/validate.test.ts src/workflow/define.ts
git commit -m "feat(crew-builder): two-tier structural + semantic IR validation"
```

---

