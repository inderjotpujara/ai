## Task 5: `compile.ts` — sequential → workflow, hierarchical → orchestrator

**Files:**
- Create: `src/crew/compile.ts`
- Test: `tests/crew/compile.test.ts`

**Interfaces:**
- Consumes: `CrewDef`, `Task`, `CrewMember` (Task 1); `effectiveTaskDeps` (Task 3); `buildCrewAgent` (Task 2); `WorkflowDef` + `StepKind` + `AgentStep` from `src/workflow/types.ts`; `defineWorkflow` from `src/workflow/define.ts`; `createOrchestrator` + `BeforeDelegate` from `src/core/orchestrator.ts` / `src/core/delegate.ts`; `createOllamaModel` from `src/providers/ollama.ts`; `qwenRouter` default export from `models/qwen-router.ts`; `Agent` from `src/core/agent-def.ts`.
- Produces:
  - `function compileToWorkflow(crew: CrewDef): WorkflowDef`
  - `function buildHierarchicalOrchestrator(crew: CrewDef, onBeforeDelegate?: BeforeDelegate): Agent`
  - `function composeTaskInput(task: Task, ctx: Record<string, unknown>, deps: string[]): string` (exported for test/reuse)

- [ ] **Step 1: Write the failing test `tests/crew/compile.test.ts`**

```typescript
import { describe, expect, it } from 'bun:test';
import { z } from 'zod';
import { Capability, PreferPolicy } from '../../src/core/types.ts';
import { buildHierarchicalOrchestrator, compileToWorkflow } from '../../src/crew/compile.ts';
import { CrewProcess, type CrewDef } from '../../src/crew/types.ts';
import { StepKind } from '../../src/workflow/types.ts';

const crew: CrewDef = {
  id: 'research', process: CrewProcess.Sequential,
  members: [
    { name: 'researcher', role: 'Analyst', goal: 'gather', backstory: 'b', requires: [Capability.Tools], prefer: PreferPolicy.LargestThatFits },
    { name: 'writer', role: 'Writer', goal: 'summarize', backstory: 'b', requires: [Capability.Tools], prefer: PreferPolicy.LargestThatFits },
  ],
  tasks: [
    { id: 'gather', description: 'Research the topic', expectedOutput: 'notes', member: 'researcher', output: z.string() },
    { id: 'write', description: 'Write a summary', expectedOutput: '3 bullets', member: 'writer' },
  ],
};

describe('compileToWorkflow', () => {
  it('maps each task to an AgentStep with member as agent + resolved deps', () => {
    const wf = compileToWorkflow(crew);
    expect(wf.id).toBe('research');
    expect(wf.steps).toHaveLength(2);
    const [s0, s1] = wf.steps;
    expect(s0.kind).toBe(StepKind.Agent);
    expect((s0 as { agent: string }).agent).toBe('researcher');
    expect((s1 as { agent: string }).agent).toBe('writer');
    // second task defaults to depending on the first (CrewAI sequential)
    expect(s1.dependsOn).toEqual(['gather']);
    // task output default -> the step still validates (z.string() when omitted)
    expect(s1.output).toBeDefined();
  });

  it('step input composes the task description + expected output', () => {
    const wf = compileToWorkflow(crew);
    const input = (wf.steps[0] as { input: (c: Record<string, unknown>) => string }).input({ input: 'AI safety' });
    expect(input).toContain('Research the topic');
    expect(input).toContain('notes');
    expect(input).toContain('AI safety'); // root task sees the crew input
  });
});

describe('buildHierarchicalOrchestrator', () => {
  it('builds a manager Agent whose tools delegate to each member', () => {
    const orch = buildHierarchicalOrchestrator({ ...crew, process: CrewProcess.Hierarchical });
    // createOrchestrator returns an Agent with delegate_to_<member> tools
    expect(orch.name).toBe('research');
    expect(Object.keys(orch.tools)).toEqual(
      expect.arrayContaining(['delegate_to_researcher', 'delegate_to_writer']),
    );
  });
});
```

(If `delegateToolName` prefixes differently, assert the actual prefix produced by `src/core/delegate.ts` — check `delegateToolName` and match it.)

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/crew/compile.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/crew/compile.ts`**

```typescript
import { z } from 'zod';
import qwenRouter from '../../models/qwen-router.ts';
import type { Agent } from '../core/agent-def.ts';
import type { BeforeDelegate } from '../core/delegate.ts';
import { createOrchestrator } from '../core/orchestrator.ts';
import { createOllamaModel } from '../providers/ollama.ts';
import {
  type WorkflowDef,
  StepKind,
} from '../workflow/types.ts';
import { defineWorkflow } from '../workflow/define.ts';
import { buildCrewAgent } from './member-agent.ts';
import { effectiveTaskDeps } from './define.ts';
import type { CrewDef, Task } from './types.ts';

/** Build the task-specific prompt: description + expected output + the outputs of
 *  its dependency tasks (or the crew input for a root task). */
export function composeTaskInput(
  task: Task,
  ctx: Record<string, unknown>,
  deps: string[],
): string {
  const parts = [task.description, `Expected output: ${task.expectedOutput}`];
  if (deps.length === 0) {
    parts.push(`\nInput:\n${String(ctx.input ?? '')}`);
  } else {
    for (const dep of deps) {
      const v = ctx[dep];
      parts.push(
        `\nContext from "${dep}":\n${typeof v === 'string' ? v : JSON.stringify(v)}`,
      );
    }
  }
  return parts.join('\n');
}

/** Sequential crew -> a WorkflowDef of agent steps (runs on the Slice-10 engine). */
export function compileToWorkflow(crew: CrewDef): WorkflowDef {
  const steps = crew.tasks.map((task, i) => {
    const deps = effectiveTaskDeps(task, i, crew.tasks);
    return {
      id: task.id,
      kind: StepKind.Agent as const,
      agent: task.member,
      dependsOn: deps,
      input: (ctx: Record<string, unknown>) => composeTaskInput(task, ctx, deps),
      output: task.output ?? z.string(),
    };
  });
  // Reuse the workflow validator as a second gate (unique ids / acyclic).
  return defineWorkflow({ id: crew.id, description: crew.description, steps });
}

/** Hierarchical crew -> the existing orchestrator with member agents as the team
 *  and an auto manager (model defaults to the router). */
export function buildHierarchicalOrchestrator(
  crew: CrewDef,
  onBeforeDelegate?: BeforeDelegate,
): Agent {
  const agents = crew.members.map((m) => buildCrewAgent(m, m.tools));
  const taskList = crew.tasks
    .map((t) => `- (${t.member}) ${t.description} -> ${t.expectedOutput}`)
    .join('\n');
  const systemPrompt = [
    'You are the manager of a crew. You do not do the work yourself; you delegate each task to the best-suited member and combine their results.',
    crew.description ? `Crew goal: ${crew.description}` : '',
    `Tasks to complete:\n${taskList}`,
  ]
    .filter(Boolean)
    .join('\n\n');

  return createOrchestrator({
    name: crew.id,
    model: createOllamaModel(crew.managerModel ?? qwenRouter),
    systemPrompt,
    agents,
    onBeforeDelegate,
  });
}
```

- [ ] **Step 4: Run tests + typecheck + lint**

Run: `bun test tests/crew/compile.test.ts && bun run typecheck && bun run lint:file -- "src/crew/compile.ts"`
Expected: PASS; clean.

- [ ] **Step 5: Commit**

```bash
git add src/crew/compile.ts tests/crew/compile.test.ts
git commit -m "feat(crew): compile sequential->workflow, hierarchical->orchestrator"
```

---

