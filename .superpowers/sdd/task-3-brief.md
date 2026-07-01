## Task 3: `defineCrew` static validation

**Files:**
- Create: `src/crew/define.ts`
- Test: `tests/crew/define.test.ts`

**Interfaces:**
- Consumes: `CrewDef`, `CrewProcess`, `Task` (Task 1); `CrewError` (Task 1).
- Produces: `function defineCrew(def: CrewDef): CrewDef` (returns unchanged if valid; throws `CrewError`). `function effectiveTaskDeps(task: Task, index: number, tasks: Task[]): string[]` (explicit `dependsOn`, else previous task, else `[]`) — exported for reuse by `compile.ts`.

- [ ] **Step 1: Write the failing test `tests/crew/define.test.ts`**

```typescript
import { describe, expect, it } from 'bun:test';
import { z } from 'zod';
import { Capability, PreferPolicy } from '../../src/core/types.ts';
import { defineCrew, effectiveTaskDeps } from '../../src/crew/define.ts';
import { CrewProcess, type CrewMember, type Task } from '../../src/crew/types.ts';

const m = (name: string): CrewMember => ({
  name, role: `${name} role`, goal: 'g', backstory: 'b',
  requires: [Capability.Tools], prefer: PreferPolicy.LargestThatFits,
});
const t = (id: string, member: string, dependsOn?: string[]): Task => ({
  id, description: 'd', expectedOutput: 'e', member, output: z.string(),
  ...(dependsOn ? { dependsOn } : {}),
});

describe('defineCrew', () => {
  it('accepts a valid sequential crew', () => {
    const def = defineCrew({
      id: 'c', process: CrewProcess.Sequential,
      members: [m('a'), m('b')], tasks: [t('t1', 'a'), t('t2', 'b')],
    });
    expect(def.tasks).toHaveLength(2);
  });

  it('rejects a task assigned to an unknown member', () => {
    expect(() => defineCrew({
      id: 'c', process: CrewProcess.Sequential,
      members: [m('a')], tasks: [t('t1', 'ghost')],
    })).toThrow(/unknown member.*ghost/i);
  });

  it('rejects an unknown dependsOn target', () => {
    expect(() => defineCrew({
      id: 'c', process: CrewProcess.Sequential,
      members: [m('a')], tasks: [t('t1', 'a'), t('t2', 'a', ['nope'])],
    })).toThrow(/unknown.*nope/i);
  });

  it('rejects duplicate member names and task ids', () => {
    expect(() => defineCrew({
      id: 'c', process: CrewProcess.Sequential,
      members: [m('a'), m('a')], tasks: [t('t1', 'a')],
    })).toThrow(/duplicate member/i);
    expect(() => defineCrew({
      id: 'c', process: CrewProcess.Sequential,
      members: [m('a')], tasks: [t('t1', 'a'), t('t1', 'a')],
    })).toThrow(/duplicate task/i);
  });

  it('rejects a task dependency cycle', () => {
    expect(() => defineCrew({
      id: 'c', process: CrewProcess.Sequential,
      members: [m('a')], tasks: [t('t1', 'a', ['t2']), t('t2', 'a', ['t1'])],
    })).toThrow(/cycle/i);
  });

  it('effectiveTaskDeps defaults to the previous task', () => {
    const tasks = [t('t1', 'a'), t('t2', 'a')];
    expect(effectiveTaskDeps(tasks[0], 0, tasks)).toEqual([]);
    expect(effectiveTaskDeps(tasks[1], 1, tasks)).toEqual(['t1']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/crew/define.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/crew/define.ts`**

```typescript
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
  return index === 0 ? [] : [tasks[index - 1].id];
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
      throw new CrewError(
        `task ${task.id}: unknown member "${task.member}"`,
      );
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
  const queue = [...indeg.entries()].filter(([, d]) => d === 0).map(([id]) => id);
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
```

- [ ] **Step 4: Run tests + typecheck + lint**

Run: `bun test tests/crew/define.test.ts && bun run typecheck && bun run lint:file -- "src/crew/define.ts"`
Expected: PASS; clean.

- [ ] **Step 5: Commit**

```bash
git add src/crew/define.ts tests/crew/define.test.ts
git commit -m "feat(crew): defineCrew static validation"
```

---

