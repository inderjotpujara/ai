## Task 1: Crew types + `CrewError`

**Files:**
- Create: `src/crew/types.ts`
- Modify: `src/core/errors.ts` (add `CrewError` after `WorkflowError`)
- Test: `tests/crew/errors.test.ts`

**Interfaces:**
- Produces: `type CrewMember`, `type Task<O>`, `enum CrewProcess`, `type CrewDef`, `type CrewOutcome`; `class CrewError extends FrameworkError`.

- [ ] **Step 1: Add `CrewError` to `src/core/errors.ts`**

Match the existing subclass pattern (e.g. `WorkflowError`); the base sets `name` via `new.target.name`, so no constructor is needed:

```typescript
export class CrewError extends FrameworkError {}
```

- [ ] **Step 2: Write `src/crew/types.ts`**

```typescript
import type { ToolSet } from 'ai';
import type { z } from 'zod';
import type {
  Capability,
  ModelDeclaration,
  PreferPolicy,
} from '../core/types.ts';

/** A role-bearing team member. role/goal/backstory are prompt scaffolding;
 *  the concrete model is resolved live by the selector from requires/prefer. */
export type CrewMember = {
  name: string; // stable id; used as the agent name + delegate tool name
  role: string; // e.g. "Senior Research Analyst"
  goal: string; // the member's individual objective
  backstory: string; // persona/context that enriches its prompt
  requires: Capability[]; // capability hard-filter for live model selection
  prefer: PreferPolicy; // soft rank over survivors
  tools?: ToolSet; // optional tools this member can call
};

/** A unit of work assigned to a member. expectedOutput is prompt guidance;
 *  output (optional) is the enforced zod schema for typed hand-offs. */
export type Task<O = unknown> = {
  id: string;
  description: string; // what to do (prompt)
  expectedOutput: string; // what good output looks like (prompt guidance)
  member: string; // CrewMember.name that runs this task
  dependsOn?: string[]; // upstream task ids whose outputs are context
  output?: z.ZodType<O>; // optional structured output; validated if present
};

export enum CrewProcess {
  Sequential = 'sequential',
  Hierarchical = 'hierarchical',
}

export type CrewDef = {
  id: string;
  description?: string;
  members: CrewMember[];
  tasks: Task[];
  process: CrewProcess;
  managerModel?: ModelDeclaration; // hierarchical only; defaults to the router
};

export type CrewOutcome =
  | { kind: 'done'; output: unknown }
  | { kind: 'failed'; failedTask?: string; message: string };
```

- [ ] **Step 3: Write the failing test `tests/crew/errors.test.ts`**

```typescript
import { describe, expect, it } from 'bun:test';
import { CrewError } from '../../src/core/errors.ts';

describe('CrewError', () => {
  it('is an Error with the right name', () => {
    const e = new CrewError('bad crew');
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('CrewError');
    expect(e.message).toBe('bad crew');
  });
});
```

- [ ] **Step 4: Run tests + typecheck**

Run: `bun test tests/crew/errors.test.ts && bun run typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/crew/types.ts src/core/errors.ts tests/crew/errors.test.ts
git commit -m "feat(crew): typed crew model + CrewError"
```

---

