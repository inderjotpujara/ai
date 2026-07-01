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
      // Safe: i < items.length is the loop invariant just checked above.
      out[i] = await fn(items[i] as T, i);
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
      const limit =
        step.maxParallel ?? deps.maxParallel ?? DEFAULT_MAX_PARALLEL;
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
