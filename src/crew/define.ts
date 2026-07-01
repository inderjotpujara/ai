import { CrewError } from '../core/errors.ts';
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

  def.tasks.forEach((task, i) => {
    if (!memberNames.has(task.member)) {
      throw new CrewError(`task ${task.id}: unknown member "${task.member}"`);
    }
    for (const dep of effectiveTaskDeps(task, i, def.tasks)) {
      if (!taskIds.has(dep)) {
        throw new CrewError(`task ${task.id}: unknown dependsOn "${dep}"`);
      }
    }
  });

  // Acyclic check via Kahn's topological sort over effective task deps.
  const indeg = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  def.tasks.forEach((t) => {
    indeg.set(t.id, 0);
    dependents.set(t.id, []);
  });
  def.tasks.forEach((task, i) => {
    for (const dep of effectiveTaskDeps(task, i, def.tasks)) {
      indeg.set(task.id, (indeg.get(task.id) ?? 0) + 1);
      dependents.get(dep)?.push(task.id);
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
  if (visited !== def.tasks.length) {
    throw new CrewError(`crew ${def.id} has a task dependency cycle`);
  }

  return def;
}
