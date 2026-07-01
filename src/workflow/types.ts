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
  | Omit<AgentStep, 'id' | 'dependsOn'>
  | Omit<ToolStep, 'id' | 'dependsOn'>;

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
  if (index === 0) return [];
  const prev = steps[index - 1];
  return prev ? [prev.id] : [];
}
