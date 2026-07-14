### Task 3: Contract status events — the transient-SSE discriminated union

**Files:**
- Create: `src/contracts/events.ts`
- Test: `tests/contracts/events.test.ts`

**Interfaces:**
- Consumes: `StatusEventType`, `DegradeKind`, `ModelLoadAction` from `./enums.ts`.
- Produces: `StatusEventSchema`/`StatusEvent` (discriminated union) plus the per-variant schemas (`RunStartEventSchema`, `ProvisionEventSchema`, `McpMountEventSchema`, `DelegationEventSchema`, `ModelSelectEventSchema`, `ModelLoadEventSchema`, `DegradeEventSchema`, `ConfirmEventSchema`, `RunEndEventSchema`).

- [ ] **Step 1: Write the failing status-event test**

```ts
// tests/contracts/events.test.ts
import { expect, test } from 'bun:test';
import {
  DegradeKind,
  ModelLoadAction,
  StatusEventType,
} from '../../src/contracts/enums.ts';
import { StatusEventSchema } from '../../src/contracts/events.ts';

test('parses a data-delegation event and discriminates on type', () => {
  const e = StatusEventSchema.parse({
    type: StatusEventType.Delegation,
    agent: 'researcher',
    depth: 1,
    parentAgent: 'router',
    ancestors: ['router'],
  });
  expect(e.type).toBe('data-delegation');
});

test('parses a data-model-load event with an enum action', () => {
  const e = StatusEventSchema.parse({
    type: StatusEventType.ModelLoad,
    model: 'qwen3.5:4b',
    action: ModelLoadAction.Warm,
  });
  expect(e.type === StatusEventType.ModelLoad && e.action).toBe('warm');
});

test('parses the bidirectional data-confirm ask', () => {
  const e = StatusEventSchema.parse({
    type: StatusEventType.Confirm,
    promptId: 'cap-abc123',
    kind: 'mcp-mount',
    question: 'Mount github MCP server?',
  });
  expect(e.type === StatusEventType.Confirm && e.promptId).toBe('cap-abc123');
});

test('data-degrade survives a JSON round-trip', () => {
  const src = {
    type: StatusEventType.Degrade,
    kind: DegradeKind.CircuitOpen,
    subject: 'ollama',
    reason: 'threshold hit',
    spanId: 's7',
  };
  const wire = JSON.parse(JSON.stringify(StatusEventSchema.parse(src)));
  expect(StatusEventSchema.parse(wire)).toEqual(src);
});

test('rejects an unknown event type', () => {
  expect(() => StatusEventSchema.parse({ type: 'data-nope' })).toThrow();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/contracts/events.test.ts`
Expected: FAIL — cannot resolve `../../src/contracts/events.ts`.

- [ ] **Step 3: Write the status-event schemas**

```ts
// src/contracts/events.ts
import { z } from 'zod';
import { DegradeKind, ModelLoadAction, StatusEventType } from './enums.ts';

export const RunStartEventSchema = z.object({
  type: z.literal(StatusEventType.RunStart),
  runId: z.string(),
  task: z.string().optional(),
});

export const ProvisionEventSchema = z.object({
  type: z.literal(StatusEventType.Provision),
  phase: z.string(),
  model: z.string().optional(),
});

export const McpMountEventSchema = z.object({
  type: z.literal(StatusEventType.McpMount),
  server: z.string(),
  outcome: z.string(),
});

export const DelegationEventSchema = z.object({
  type: z.literal(StatusEventType.Delegation),
  agent: z.string(),
  depth: z.number(),
  parentAgent: z.string().optional(),
  ancestors: z.array(z.string()),
});

export const ModelSelectEventSchema = z.object({
  type: z.literal(StatusEventType.ModelSelect),
  agent: z.string(),
  model: z.string(),
  numCtx: z.number().optional(),
  footprintBytes: z.number().optional(),
  install: z.boolean().optional(),
  degraded: z.boolean().optional(),
});

export const ModelLoadEventSchema = z.object({
  type: z.literal(StatusEventType.ModelLoad),
  model: z.string(),
  action: z.enum(ModelLoadAction),
});

export const DegradeEventSchema = z.object({
  type: z.literal(StatusEventType.Degrade),
  kind: z.enum(DegradeKind),
  subject: z.string(),
  reason: z.string(),
  spanId: z.string().optional(),
});

/**
 * `kind` is a free string, not an enum: consent kinds come from many engine
 * seams (mcp-mount, provision, build, reuse, archive, gen-download, clone, mic,
 * disk-shortfall…) and grow per future slice, so a closed enum would churn.
 */
export const ConfirmEventSchema = z.object({
  type: z.literal(StatusEventType.Confirm),
  promptId: z.string(),
  kind: z.string(),
  question: z.string(),
});

export const RunEndEventSchema = z.object({
  type: z.literal(StatusEventType.RunEnd),
  runId: z.string(),
  outcome: z.string(),
});

export const StatusEventSchema = z.discriminatedUnion('type', [
  RunStartEventSchema,
  ProvisionEventSchema,
  McpMountEventSchema,
  DelegationEventSchema,
  ModelSelectEventSchema,
  ModelLoadEventSchema,
  DegradeEventSchema,
  ConfirmEventSchema,
  RunEndEventSchema,
]);
export type StatusEvent = z.infer<typeof StatusEventSchema>;
```

- [ ] **Step 4: Run status-event test to verify it passes**

Run: `bun test tests/contracts/events.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/contracts/events.ts tests/contracts/events.test.ts
git commit -m "feat(contracts): add StatusEvent transient-SSE discriminated union"
```

---

