import { WorkflowError } from '../core/errors.ts';
import { effectiveDeps, StepKind, type WorkflowDef } from './types.ts';

/** Validate a workflow definition at construction:
 *  unique ids · resolvable deps + branch targets · acyclic dependency graph. */
export function defineWorkflow(def: WorkflowDef): WorkflowDef {
  const { steps } = def;
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
