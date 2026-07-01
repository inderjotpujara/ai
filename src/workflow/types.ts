import type { z } from 'zod';

/** The step kinds supported by the engine. Agent/Tool/Branch/Map are the v1
 *  core; Verify is the Slice-13 grounded-verification op (additive). */
export enum StepKind {
  Agent = 'agent',
  Tool = 'tool',
  Branch = 'branch',
  Map = 'map',
  Verify = 'verify',
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
  /** Per-step override of the engine's memory auto-write policy. Only takes
   *  effect when `deps.memory` is set; default true (inherits engine default). */
  persistMemory?: boolean;
};

export type AgentStep<O = unknown> = StepBase<O> & {
  kind: StepKind.Agent;
  agent: string; // agent name resolved from the agent map at run time
  input: (ctx: WorkflowContext) => string; // the task prompt for the agent
  /** Opt-in grounded verification: when true (and the run is given `verifyDeps`),
   *  `defineWorkflow` splices a verify → branch(supported?) → bounded-CRAG
   *  corrective → abstain sub-graph after this step (mirrors the crew compiler's
   *  `task.verify`). Additive; a step without it compiles as before. */
  verify?: boolean;
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

/** A grounded-verification op. `run(ctx, deps)` is a self-contained async closure
 *  that reads the threaded context (+ the runtime deps, e.g. to re-run an agent
 *  for the corrective re-answer) and returns this step's result (validated
 *  against `output` like any other step). The compiler builds these closures, so
 *  the engine stays agnostic to verification details. `deps` is passed as the
 *  loosely-typed WorkflowVerifyDeps to avoid a types→engine import cycle.
 *  The discriminating `op` tag is telemetry/debugging metadata only. */
export type VerifyStep<O = unknown> = StepBase<O> & {
  kind: StepKind.Verify;
  op: 'verify' | 'corrective' | 'pass' | 'abstain';
  run: (ctx: WorkflowContext, deps: WorkflowVerifyDeps) => Promise<O>;
};

/** The slice of runtime deps a Verify op may need: re-run an answering agent
 *  (corrective re-answer) and re-recall evidence. Kept structural (no import of
 *  the verification module) so `types.ts` has no engine/verification dependency. */
export type WorkflowVerifyDeps = {
  runAgentStep: (agentName: string, task: string) => Promise<string>;
  recall?: (query: string) => Promise<unknown[]>;
};

export type Step = AgentStep | ToolStep | BranchStep | MapStep | VerifyStep;

export type WorkflowDef = {
  id: string;
  description?: string;
  steps: Step[];
};

export type WorkflowOutcome =
  | { kind: 'done'; output: WorkflowContext }
  | { kind: 'failed'; failedStep: string; message: string }
  /** A verified step's answer stayed unsupported after the bounded corrective
   *  retries — the workflow abstains rather than emit a hallucination. Mirrors
   *  the crew engine's `CrewOutcome` `unverified` variant (src/crew/types.ts). */
  | {
      kind: 'unverified';
      failedStepId?: string;
      unsupportedClaims: string[];
      faithfulness: number;
      draft: string;
    };

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
