import { z } from 'zod';
import qwenRouter from '../../models/qwen-router.ts';
import type { Agent } from '../core/agent-def.ts';
import type { BeforeDelegate } from '../core/delegate.ts';
import { createOrchestrator } from '../core/orchestrator.ts';
import { createOllamaModel } from '../providers/ollama.ts';
import type { DegradationLedger } from '../reliability/ledger.ts';
import { ATTR, annotateStep } from '../telemetry/spans.ts';
import { expandVerification } from '../verification/expand.ts';
import type { VerifyDeps } from '../verification/types.ts';
import { defineWorkflow } from '../workflow/define.ts';
import { type Step, StepKind, type WorkflowDef } from '../workflow/types.ts';
import { effectiveTaskDeps } from './define.ts';
import { buildCrewAgent } from './member-agent.ts';
import type { CrewDef, Task } from './types.ts';

/** Compile-time inputs for the grounded-verification sub-graph. Present only when
 *  the crew is run with verify deps; absent = no task is expanded (today's path).*/
export type CompileVerifyOpts = {
  verifyDeps: VerifyDeps;
  space?: string;
  maxRetries?: number;
  threshold?: number;
};

/** A task is verified when it opts in, or the crew defaults verify on. */
function taskVerifies(task: Task, crew: CrewDef): boolean {
  return task.verify ?? crew.verify ?? false;
}

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

/** Sequential crew -> a WorkflowDef of agent steps (runs on the Slice-10 engine).
 *  When `verifyOpts` is supplied, any task that opts into `verify` gets its
 *  grounded-verification sub-graph spliced in right after its answer step. A task
 *  without `verify` (or when `verifyOpts` is absent) compiles exactly as before. */
export function compileToWorkflow(
  crew: CrewDef,
  verifyOpts?: CompileVerifyOpts,
): WorkflowDef {
  const steps: Step[] = [];
  crew.tasks.forEach((task, i) => {
    const deps = effectiveTaskDeps(task, i, crew.tasks);
    steps.push({
      id: task.id,
      kind: StepKind.Agent,
      agent: task.member,
      dependsOn: deps,
      input: (ctx: Record<string, unknown>) => {
        annotateStep({ [ATTR.CREW_TASK_MEMBER]: task.member });
        return composeTaskInput(task, ctx, deps);
      },
      output: task.output ?? z.string(),
      persistMemory: task.persistMemory,
    });
    if (verifyOpts && taskVerifies(task, crew)) {
      steps.push(
        ...expandVerification({
          answerStepId: task.id,
          answerAgent: task.member,
          space: verifyOpts.space ?? 'default',
          verifyDeps: verifyOpts.verifyDeps,
          maxRetries: verifyOpts.maxRetries,
          threshold: verifyOpts.threshold,
        }),
      );
    }
  });
  // Reuse the workflow validator as a second gate (unique ids / acyclic).
  return defineWorkflow({ id: crew.id, description: crew.description, steps });
}

/** Hierarchical crew -> the existing orchestrator with member agents as the team
 *  and an auto manager (model defaults to the router). */
export function buildHierarchicalOrchestrator(
  crew: CrewDef,
  onBeforeDelegate?: BeforeDelegate,
  ledger?: DegradationLedger,
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
    ledger,
  });
}
