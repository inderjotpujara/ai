## Task 6: `runCrew` engine (dispatch by process) + thread `onBeforeDelegate` through `defaultRunAgentStep`

**Files:**
- Create: `src/crew/engine.ts`
- Modify: `src/workflow/run-step.ts` (add optional `onBeforeDelegate` param to `defaultRunAgentStep` — backward compatible; enables live model selection in workflow + crew agent steps)
- Test: `tests/crew/engine.test.ts`, `tests/workflow/run-step.test.ts` (add one assertion that the hook is threaded)

**Interfaces:**
- Consumes: `CrewDef`, `CrewProcess`, `CrewOutcome`, `CrewMember` (Task 1); `compileToWorkflow` + `buildHierarchicalOrchestrator` (Task 5); `buildCrewAgent` (Task 2); `withCrewSpan` (Task 4); `runWorkflow` + `WorkflowDeps` + `defaultRunAgentStep` from `src/workflow/engine.ts`; `runGuardedAgent` + `BeforeDelegate` from `src/core/delegate.ts`; `runOrchestrator` from `src/core/orchestrator.ts`; `Agent` from `src/core/agent-def.ts`; `ToolSet` from `ai`.
- Produces (modified): `defaultRunAgentStep(agents: Record<string, Agent>, onBeforeDelegate?: BeforeDelegate): WorkflowDeps['runAgentStep']` — now passes `onBeforeDelegate` into `runGuardedAgent`.
- Produces:
  - `type CrewDeps = { runAgentStep?: WorkflowDeps['runAgentStep']; tools: ToolSet; maxParallel?: number; onBeforeDelegate?: import('../core/delegate.ts').BeforeDelegate }`
  - `function crewAgentMap(crew: CrewDef, tools: ToolSet): Record<string, Agent>` (build member agents keyed by name)
  - `function runCrew(def: CrewDef, input: unknown, deps: CrewDeps): Promise<CrewOutcome>`

- [ ] **Step 1: Write the failing test `tests/crew/engine.test.ts`**

```typescript
import { describe, expect, it } from 'bun:test';
import { z } from 'zod';
import { Capability, PreferPolicy } from '../../src/core/types.ts';
import { runCrew } from '../../src/crew/engine.ts';
import { CrewProcess, type CrewDef } from '../../src/crew/types.ts';

const seqCrew: CrewDef = {
  id: 'c', process: CrewProcess.Sequential,
  members: [
    { name: 'a', role: 'A', goal: 'g', backstory: 'b', requires: [Capability.Tools], prefer: PreferPolicy.LargestThatFits },
    { name: 'b', role: 'B', goal: 'g', backstory: 'b', requires: [Capability.Tools], prefer: PreferPolicy.LargestThatFits },
  ],
  tasks: [
    { id: 't1', description: 'do first', expectedOutput: 'x', member: 'a', output: z.string() },
    { id: 't2', description: 'do second', expectedOutput: 'y', member: 'b', output: z.string() },
  ],
};

describe('runCrew (sequential)', () => {
  it('threads task output as context to the next task', async () => {
    const seen: string[] = [];
    const outcome = await runCrew(seqCrew, 'topic', {
      tools: {},
      // stub the agent runner: echo which member + whether it saw upstream context
      runAgentStep: async (member, task) => {
        seen.push(member);
        return `${member}:${task.includes('t1') ? 'saw-t1' : 'root'}`;
      },
    });
    expect(outcome.kind).toBe('done');
    if (outcome.kind === 'done') {
      const out = outcome.output as Record<string, unknown>;
      expect(out.t1).toBe('a:root');
      expect(out.t2).toBe('b:saw-t1'); // t2's prompt embedded t1's output under "Context from \"t1\""
    }
    expect(seen).toEqual(['a', 'b']);
  });

  it('reports a failed task via the outcome', async () => {
    const outcome = await runCrew(seqCrew, 'topic', {
      tools: {},
      runAgentStep: async (member) => {
        if (member === 'b') throw new Error('boom');
        return 'ok';
      },
    });
    expect(outcome).toMatchObject({ kind: 'failed', failedTask: 't2' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/crew/engine.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 2b: Thread `onBeforeDelegate` through `defaultRunAgentStep` in `src/workflow/run-step.ts`**

Change the signature to accept an optional hook and pass it into `runGuardedAgent` (backward compatible — existing callers pass nothing and behave exactly as before). Add `BeforeDelegate` to the existing `import type { ... } from '../core/delegate.ts'` line (which already imports `runGuardedAgent`):

```typescript
export function defaultRunAgentStep(
  agents: Record<string, Agent>,
  onBeforeDelegate?: BeforeDelegate,
): WorkflowDeps['runAgentStep'] {
  return async (agentName, task) => {
    const agent = agents[agentName];
    if (!agent) throw new WorkflowError(`unknown agent: ${agentName}`);
    const result = await runGuardedAgent(agent, task, onBeforeDelegate);
    if ('error' in result) throw new WorkflowError(result.error);
    return result.text;
  };
}
```

Add one assertion to `tests/workflow/run-step.test.ts` proving the hook is passed (e.g. a spy `onBeforeDelegate` that records the agent name it was called with when a real agent runs). Keep all existing run-step tests green (regression).

- [ ] **Step 3: Write `src/crew/engine.ts`**

```typescript
import type { ToolSet } from 'ai';
import type { Agent } from '../core/agent-def.ts';
import type { BeforeDelegate } from '../core/delegate.ts';
import { runOrchestrator } from '../core/orchestrator.ts';
import { withCrewSpan } from '../telemetry/spans.ts';
import {
  type WorkflowDeps,
  defaultRunAgentStep,
  runWorkflow,
} from '../workflow/engine.ts';
import { buildHierarchicalOrchestrator, compileToWorkflow } from './compile.ts';
import { buildCrewAgent } from './member-agent.ts';
import { CrewProcess, type CrewDef, type CrewOutcome } from './types.ts';

export type CrewDeps = {
  runAgentStep?: WorkflowDeps['runAgentStep'];
  tools: ToolSet;
  maxParallel?: number;
  onBeforeDelegate?: BeforeDelegate;
};

/** Build the crew's member agents keyed by name (for the sequential agent map). */
export function crewAgentMap(crew: CrewDef, tools: ToolSet): Record<string, Agent> {
  const map: Record<string, Agent> = {};
  for (const member of crew.members) {
    map[member.name] = buildCrewAgent(member, member.tools ?? tools);
  }
  return map;
}

/** Run a crew: sequential -> the Slice-10 workflow engine; hierarchical -> the
 *  orchestrator. Wrapped in a crew.run span; never throws into the caller. */
export function runCrew(
  def: CrewDef,
  input: unknown,
  deps: CrewDeps,
): Promise<CrewOutcome> {
  return withCrewSpan(def.id, def.process, async () => {
    if (def.process === CrewProcess.Sequential) {
      const wf = compileToWorkflow(def);
      const runAgentStep =
        deps.runAgentStep ??
        defaultRunAgentStep(crewAgentMap(def, deps.tools), deps.onBeforeDelegate);
      const outcome = await runWorkflow(wf, input, {
        runAgentStep,
        tools: deps.tools,
        maxParallel: deps.maxParallel,
      });
      if (outcome.kind === 'done') return { kind: 'done', output: outcome.output };
      return {
        kind: 'failed',
        failedTask: outcome.failedStep,
        message: outcome.message,
      };
    }

    // Hierarchical: the orchestrator is the manager.
    const orch = buildHierarchicalOrchestrator(def, deps.onBeforeDelegate);
    const task = `${String(input)}\n\nComplete the crew's tasks by delegating to your members.`;
    const result = await runOrchestrator(orch, task);
    if (result.kind === 'answer') return { kind: 'done', output: result.text };
    return { kind: 'failed', message: result.message };
  });
}
```

- [ ] **Step 4: Run tests + typecheck + lint**

Run: `bun test tests/crew/engine.test.ts && bun run typecheck && bun run lint:file -- "src/crew/engine.ts"`
Expected: PASS; clean.

- [ ] **Step 5: Commit**

```bash
git add src/crew/engine.ts tests/crew/engine.test.ts
git commit -m "feat(crew): runCrew dispatches sequential/hierarchical under crew.run"
```

---

