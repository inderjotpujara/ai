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

/** Pure graph gate: every edge's endpoints (`[from, to]`, "from must complete
 *  before to") must be a known id, and the graph must be acyclic (Kahn's
 *  topological sort). No knowledge of steps/tasks/closures — just ids and
 *  edges — so it's shared by `defineWorkflow`, `defineCrew`, and the
 *  crew-builder IR validator (which checks a graph shape before any real
 *  `Step`/`Task` closures exist). Throws a plain `Error`; callers wrap it in
 *  their own domain error type for a domain-flavored message. */
export function assertAcyclic(
  ids: string[],
  edges: Array<[from: string, to: string]>,
): void {
  const known = new Set(ids);
  for (const [from, to] of edges) {
    if (!known.has(from)) {
      throw new Error(`dependency edge references unknown id "${from}"`);
    }
    if (!known.has(to)) {
      throw new Error(`dependency edge references unknown id "${to}"`);
    }
  }

  const indeg = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const id of ids) {
    indeg.set(id, 0);
    dependents.set(id, []);
  }
  for (const [from, to] of edges) {
    indeg.set(to, (indeg.get(to) ?? 0) + 1);
    dependents.get(from)?.push(to);
  }

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
  if (visited !== ids.length) {
    throw new Error('dependency graph has a cycle');
  }
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

  // Branch targets must resolve to a real step (not part of the dependency
  // graph itself — a branch's own deps come from effectiveDeps below).
  for (const step of steps) {
    if (step.kind === StepKind.Branch) {
      for (const target of [step.whenTrue, step.whenFalse]) {
        if (!ids.has(target)) {
          throw new WorkflowError(
            `branch ${step.id}: unknown target "${target}"`,
          );
        }
      }
    }
  }

  // dependsOn resolution + acyclicity, via the shared Kahn/reference-integrity gate.
  const edges: Array<[string, string]> = [];
  steps.forEach((step, i) => {
    for (const dep of effectiveDeps(step, i, steps)) {
      edges.push([dep, step.id]);
    }
  });
  try {
    assertAcyclic([...ids], edges);
  } catch (e) {
    throw new WorkflowError(`workflow ${def.id}: ${(e as Error).message}`);
  }

  return def;
}
