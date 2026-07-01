import { WorkflowError } from '../core/errors.ts';
import { expandVerification } from '../verification/expand.ts';
import type { VerifyDeps } from '../verification/types.ts';
import {
  effectiveDeps,
  type Step,
  StepKind,
  type WorkflowDef,
} from './types.ts';

/** Compile-time inputs for the grounded-verification sub-graph. Present only when
 *  the workflow is defined with verify deps; absent = no step is expanded (today's
 *  path). Mirrors `CompileVerifyOpts` in src/crew/compile.ts. */
export type DefineVerifyOpts = {
  verifyDeps: VerifyDeps;
  space?: string;
  maxRetries?: number;
  threshold?: number;
};

/** Splice each `verify: true` agent step's grounded-verification sub-graph in
 *  right after it, reusing the shared expander verbatim. A step without
 *  `verify` (or when `verifyOpts` is absent) passes through unchanged. */
function expandVerifiedSteps(
  steps: Step[],
  verifyOpts: DefineVerifyOpts,
): Step[] {
  const expanded: Step[] = [];
  for (const step of steps) {
    expanded.push(step);
    if (step.kind === StepKind.Agent && step.verify) {
      expanded.push(
        ...expandVerification({
          answerStepId: step.id,
          answerAgent: step.agent,
          space: verifyOpts.space ?? 'default',
          verifyDeps: verifyOpts.verifyDeps,
          maxRetries: verifyOpts.maxRetries,
          threshold: verifyOpts.threshold,
        }),
      );
    }
  }
  return expanded;
}

/** Validate a workflow definition at construction:
 *  unique ids · resolvable deps + branch targets · acyclic dependency graph.
 *  When `verifyOpts` is supplied, any `AgentStep` that opts into `verify` gets
 *  its grounded-verification sub-graph spliced in right after it (mirrors the
 *  crew compiler's `compileToWorkflow`). A step without `verify` (or when
 *  `verifyOpts` is absent) compiles exactly as before — byte-for-byte. */
export function defineWorkflow(
  def: WorkflowDef,
  verifyOpts?: DefineVerifyOpts,
): WorkflowDef {
  const steps = verifyOpts
    ? expandVerifiedSteps(def.steps, verifyOpts)
    : def.steps;
  def = { ...def, steps };
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
  const queue = [...indeg.entries()]
    .filter(([, d]) => d === 0)
    .map(([id]) => id);
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
