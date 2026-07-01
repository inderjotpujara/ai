import { z } from 'zod';
import qwenRouter from '../../models/qwen-router.ts';
import type { Agent } from '../core/agent-def.ts';
import type { BeforeDelegate } from '../core/delegate.ts';
import { createOrchestrator } from '../core/orchestrator.ts';
import { createOllamaModel } from '../providers/ollama.ts';
import { ATTR, annotateStep } from '../telemetry/spans.ts';
import { defineWorkflow } from '../workflow/define.ts';
import { StepKind, type WorkflowDef } from '../workflow/types.ts';
import { effectiveTaskDeps } from './define.ts';
import { buildCrewAgent } from './member-agent.ts';
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
      input: (ctx: Record<string, unknown>) => {
        annotateStep({ [ATTR.CREW_TASK_MEMBER]: task.member });
        return composeTaskInput(task, ctx, deps);
      },
      output: task.output ?? z.string(),
      persistMemory: task.persistMemory,
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
