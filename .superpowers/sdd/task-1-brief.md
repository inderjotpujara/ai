### Task 1: IR types + Zod schemas (`ir.ts`)

**Files:**
- Create: `src/crew-builder/ir.ts`
- Test: `tests/crew-builder/ir.test.ts`

**Interfaces:**
- Produces: `CrewIR`, `WorkflowIR`, `InputDescriptor`, `PredicateDescriptor`, and their Zod schemas `CrewIRSchema`, `WorkflowIRSchema`. Consumed by every later task.

- [ ] **Step 1: Write the failing test**

```ts
// tests/crew-builder/ir.test.ts
import { expect, test } from 'bun:test';
import { CrewIRSchema, WorkflowIRSchema } from '../../src/crew-builder/ir.ts';

test('WorkflowIRSchema accepts a valid agent+tool+branch graph', () => {
  const ir = {
    id: 'fetch_and_check',
    description: 'fetch then branch',
    steps: [
      { kind: 'tool', id: 'fetch', tool: 'fetch', input: { kind: 'fromInput' } },
      { kind: 'agent', id: 'summarize', agent: 'web_fetch', dependsOn: ['fetch'], input: { kind: 'fromStep', ref: 'fetch' } },
      { kind: 'branch', id: 'ok', dependsOn: ['summarize'], predicate: { kind: 'whenContains', ref: 'summarize', substr: 'error' }, whenTrue: 'summarize', whenFalse: 'summarize' },
    ],
  };
  expect(WorkflowIRSchema.safeParse(ir).success).toBe(true);
});

test('CrewIRSchema accepts inline + agentRef members', () => {
  const ir = {
    id: 'research_crew', description: 'x', process: 'sequential',
    members: [
      { name: 'researcher', role: 'r', goal: 'g', backstory: 'b', requires: ['tools'] },
      { name: 'web_fetch', agentRef: 'web_fetch', role: 'fetcher', goal: 'g', backstory: 'b', requires: ['tools'] },
    ],
    tasks: [{ id: 'gather', description: 'd', expectedOutput: 'o', member: 'researcher' }],
  };
  expect(CrewIRSchema.safeParse(ir).success).toBe(true);
});

test('WorkflowIRSchema rejects an unknown step kind', () => {
  expect(WorkflowIRSchema.safeParse({ id: 'x', steps: [{ kind: 'nope', id: 'a' }] }).success).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/crew-builder/ir.test.ts`
Expected: FAIL — cannot find module `ir.ts`.

- [ ] **Step 3: Write the implementation**

```ts
// src/crew-builder/ir.ts
import { z } from 'zod';

/** How a step/task input closure is produced (JSON-safe descriptor, not a closure). */
export const InputDescriptorSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('fromInput') }),
  z.object({ kind: z.literal('fromStep'), ref: z.string().min(1) }),
  z.object({ kind: z.literal('fromTemplate'), template: z.string().min(1) }),
]);
export type InputDescriptor = z.infer<typeof InputDescriptorSchema>;

/** How a branch predicate closure is produced. */
export const PredicateDescriptorSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('whenEquals'), ref: z.string().min(1), value: z.string() }),
  z.object({ kind: z.literal('whenContains'), ref: z.string().min(1), substr: z.string().min(1) }),
  z.object({ kind: z.literal('whenTruthy'), ref: z.string().min(1) }),
]);
export type PredicateDescriptor = z.infer<typeof PredicateDescriptorSchema>;

const AgentStepIR = z.object({
  kind: z.literal('agent'), id: z.string().min(1), agent: z.string().min(1),
  dependsOn: z.array(z.string()).optional(), input: InputDescriptorSchema, verify: z.boolean().optional(),
});
const ToolStepIR = z.object({
  kind: z.literal('tool'), id: z.string().min(1), tool: z.string().min(1),
  dependsOn: z.array(z.string()).optional(), input: InputDescriptorSchema,
});
const BranchStepIR = z.object({
  kind: z.literal('branch'), id: z.string().min(1), dependsOn: z.array(z.string()).optional(),
  predicate: PredicateDescriptorSchema, whenTrue: z.string().min(1), whenFalse: z.string().min(1),
});
const MapSubStepIR = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('agent'), agent: z.string().min(1), input: InputDescriptorSchema }),
  z.object({ kind: z.literal('tool'), tool: z.string().min(1), input: InputDescriptorSchema }),
]);
const MapStepIR = z.object({
  kind: z.literal('map'), id: z.string().min(1), dependsOn: z.array(z.string()).optional(),
  over: z.object({ kind: z.literal('mapOver'), ref: z.string().min(1) }), step: MapSubStepIR,
});

export const WorkflowStepIRSchema = z.discriminatedUnion('kind', [AgentStepIR, ToolStepIR, BranchStepIR, MapStepIR]);
export type WorkflowStepIR = z.infer<typeof WorkflowStepIRSchema>;

export const WorkflowIRSchema = z.object({
  id: z.string().min(1), description: z.string().optional(), steps: z.array(WorkflowStepIRSchema).min(1),
});
export type WorkflowIR = z.infer<typeof WorkflowIRSchema>;

export const CrewMemberIRSchema = z.object({
  name: z.string().min(1),
  agentRef: z.string().optional(), // registered AGENTS name to reuse; absent = inline member
  role: z.string().min(1), goal: z.string().min(1), backstory: z.string().min(1),
  requires: z.array(z.string()).min(1), tools: z.array(z.string()).optional(),
});
export type CrewMemberIR = z.infer<typeof CrewMemberIRSchema>;

export const CrewTaskIRSchema = z.object({
  id: z.string().min(1), description: z.string().min(1), expectedOutput: z.string().min(1),
  member: z.string().min(1), dependsOn: z.array(z.string()).optional(), verify: z.boolean().optional(),
});

export const CrewIRSchema = z.object({
  id: z.string().min(1), description: z.string().optional(),
  process: z.enum(['sequential', 'hierarchical']),
  members: z.array(CrewMemberIRSchema).min(1), tasks: z.array(CrewTaskIRSchema).min(1),
});
export type CrewIR = z.infer<typeof CrewIRSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/crew-builder/ir.test.ts && bun run typecheck`
Expected: PASS (3 tests), typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/crew-builder/ir.ts tests/crew-builder/ir.test.ts
git commit -m "feat(crew-builder): IR types + Zod schemas"
```

---

