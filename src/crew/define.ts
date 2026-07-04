import { CrewError } from '../core/errors.ts';
import { assertAcyclic } from '../workflow/define.ts';
import type { CrewDef, Task } from './types.ts';

/** A task's effective dependencies: explicit dependsOn, else the previous task
 *  (CrewAI sequential default), else [] for the first task. Shared with compile. */
export function effectiveTaskDeps(
  task: Task,
  index: number,
  tasks: Task[],
): string[] {
  if (task.dependsOn) return task.dependsOn;
  if (index === 0) return [];
  const prevTask = tasks[index - 1];
  return prevTask ? [prevTask.id] : [];
}

/** Validate a crew at construction: unique member names + task ids, every
 *  task.member and dependsOn resolves, and the task graph is acyclic. */
export function defineCrew(def: CrewDef): CrewDef {
  const memberNames = new Set<string>();
  for (const member of def.members) {
    if (memberNames.has(member.name)) {
      throw new CrewError(`duplicate member name: ${member.name}`);
    }
    memberNames.add(member.name);
  }

  const taskIds = new Set<string>();
  for (const task of def.tasks) {
    if (taskIds.has(task.id)) {
      throw new CrewError(`duplicate task id: ${task.id}`);
    }
    taskIds.add(task.id);
  }

  def.tasks.forEach((task) => {
    if (!memberNames.has(task.member)) {
      throw new CrewError(`task ${task.id}: unknown member "${task.member}"`);
    }
  });

  // dependsOn resolution + acyclicity, via the shared Kahn/reference-integrity gate.
  const edges: Array<[string, string]> = [];
  def.tasks.forEach((task, i) => {
    for (const dep of effectiveTaskDeps(task, i, def.tasks)) {
      edges.push([dep, task.id]);
    }
  });
  try {
    assertAcyclic([...taskIds], edges);
  } catch (e) {
    throw new CrewError(`crew ${def.id}: ${(e as Error).message}`);
  }

  return def;
}
