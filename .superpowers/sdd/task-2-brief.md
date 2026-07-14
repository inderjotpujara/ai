### Task 2: Contract DTOs — RunDTO / SpanDTO / DegradeDTO / ChatMessageDTO

**Files:**
- Create: `src/contracts/dto.ts`
- Test: `tests/contracts/dto.test.ts`, `tests/contracts/degrade-kind-parity.test.ts`

**Interfaces:**
- Consumes: `RunOrigin`, `RunLifecycle`, `SpanStatus`, `ArtifactKind`, `DegradeKind`, `ChatRole` from `./enums.ts`.
- Produces: `DegradeDtoSchema`/`DegradeDTO`, `SpanDtoSchema`/`SpanDTO`, `RunDtoSchema`/`RunDTO`, `ChatMessageDtoSchema`/`ChatMessageDTO`.

- [ ] **Step 1: Write the failing DTO round-trip test**

```ts
// tests/contracts/dto.test.ts
import { expect, test } from 'bun:test';
import {
  ArtifactKind,
  DegradeKind,
  RunLifecycle,
  RunOrigin,
  SpanStatus,
} from '../../src/contracts/enums.ts';
import {
  RunDtoSchema,
  SpanDtoSchema,
} from '../../src/contracts/dto.ts';

const minimalSpan = {
  spanId: 's1',
  parentSpanId: null,
  name: 'agent.run',
  offsetMs: 0,
  durationMs: 12,
  depth: 0,
  status: SpanStatus.Ok,
  degraded: false,
  attributes: {},
  events: [],
};

test('SpanDTO parses with only required fields (forward-compat optionals absent)', () => {
  const parsed = SpanDtoSchema.parse(minimalSpan);
  expect(parsed.spanId).toBe('s1');
  expect(parsed.agent).toBeUndefined();
});

test('SpanDTO survives a JSON serialize/parse round-trip with optionals present', () => {
  const rich = {
    ...minimalSpan,
    statusMessage: 'ok',
    agent: 'researcher',
    delegation: { target: 'researcher', depth: 1, ancestors: ['router'] },
    model: { id: 'qwen3.5:4b', provider: 'ollama', numCtx: 8192, footprintBytes: 42, runtimeDegraded: false },
    tokens: { input: 10, output: 20 },
    node: 'reserved-slice-31',
    attributes: { 'crew.id': 'x' },
    events: [{ name: 'agent.model.select', offsetMs: 3, attributes: { m: 1 } }],
  };
  const wire = JSON.parse(JSON.stringify(SpanDtoSchema.parse(rich)));
  expect(SpanDtoSchema.parse(wire)).toEqual(rich);
});

test('RunDTO parses with reserved owner + lifecycle + origin and nested spans', () => {
  const run = {
    id: 'run-123',
    owner: 'local',
    origin: RunOrigin.Manual,
    lifecycle: RunLifecycle.Done,
    startMs: 1000,
    durationMs: 50,
    outcome: 'answer',
    models: ['qwen3.5:4b'],
    degraded: true,
    degrades: [{ kind: DegradeKind.Retried, label: 'retried', subject: 'ollama', reason: 'timeout', attempts: 2 }],
    malformedSpans: 0,
    spanCount: 1,
    roots: ['s1'],
    spans: [minimalSpan],
    artifacts: [{ name: 'answer.txt', bytes: 12, kind: ArtifactKind.Answer }],
  };
  const parsed = RunDtoSchema.parse(run);
  expect(parsed.owner).toBe('local');
  expect(parsed.tokens).toBeUndefined();
  expect(parsed.degrades[0].kind).toBe(DegradeKind.Retried);
});

test('RunDTO rejects an unknown lifecycle value', () => {
  expect(() => RunDtoSchema.parse({ ...{}, lifecycle: 'exploded' })).toThrow();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/contracts/dto.test.ts`
Expected: FAIL — cannot resolve `../../src/contracts/dto.ts`.

- [ ] **Step 3: Write the DTO schemas**

```ts
// src/contracts/dto.ts
import { z } from 'zod';
import {
  ArtifactKind,
  ChatRole,
  DegradeKind,
  RunLifecycle,
  RunOrigin,
  SpanStatus,
} from './enums.ts';

/** Optional token roll-up; mapper tolerates absence (telemetry gap #1). */
const TokensSchema = z
  .object({ input: z.number().optional(), output: z.number().optional() })
  .optional();

export const DegradeDtoSchema = z.object({
  kind: z.enum(DegradeKind),
  label: z.string(),
  subject: z.string(),
  reason: z.string(),
  from: z.string().optional(),
  to: z.string().optional(),
  attempts: z.number().optional(),
  lane: z.string().optional(),
  spanId: z.string().optional(),
});
export type DegradeDTO = z.infer<typeof DegradeDtoSchema>;

export const SpanDtoSchema = z.object({
  spanId: z.string(),
  parentSpanId: z.string().nullable(),
  name: z.string(),
  offsetMs: z.number(),
  durationMs: z.number(),
  depth: z.number(),
  status: z.enum(SpanStatus),
  statusMessage: z.string().optional(),
  agent: z.string().optional(),
  delegation: z
    .object({
      target: z.string(),
      depth: z.number(),
      ancestors: z.array(z.string()),
    })
    .optional(),
  model: z
    .object({
      id: z.string(),
      provider: z.string().optional(),
      numCtx: z.number().optional(),
      footprintBytes: z.number().optional(),
      runtimeDegraded: z.boolean().optional(),
    })
    .optional(),
  tokens: TokensSchema,
  degraded: z.boolean(),
  /** Reserved for Slices 31/38 (node/location). */
  node: z.string().optional(),
  attributes: z.record(z.string(), z.unknown()),
  events: z.array(
    z.object({
      name: z.string(),
      offsetMs: z.number(),
      attributes: z.record(z.string(), z.unknown()).optional(),
    }),
  ),
});
export type SpanDTO = z.infer<typeof SpanDtoSchema>;

export const RunDtoSchema = z.object({
  id: z.string(),
  /** Reserved now, constant "local"; backfilling ownership later (Slices 24/33). */
  owner: z.string(),
  origin: z.enum(RunOrigin),
  lifecycle: z.enum(RunLifecycle),
  startMs: z.number(),
  durationMs: z.number(),
  outcome: z.string(),
  models: z.array(z.string()),
  contentPolicy: z.string().optional(),
  tokens: TokensSchema,
  degraded: z.boolean(),
  degrades: z.array(DegradeDtoSchema),
  malformedSpans: z.number(),
  spanCount: z.number(),
  roots: z.array(z.string()),
  spans: z.array(SpanDtoSchema),
  artifacts: z.array(
    z.object({
      name: z.string(),
      bytes: z.number(),
      kind: z.enum(ArtifactKind),
    }),
  ),
});
export type RunDTO = z.infer<typeof RunDtoSchema>;

export const ChatMessageDtoSchema = z.object({
  id: z.string(),
  role: z.enum(ChatRole),
  text: z.string(),
  /** Slice 37 taint/trust marker. */
  degraded: z.boolean().optional(),
});
export type ChatMessageDTO = z.infer<typeof ChatMessageDtoSchema>;
```

- [ ] **Step 4: Run DTO test to verify it passes**

Run: `bun test tests/contracts/dto.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Write the DegradeKind parity test**

```ts
// tests/contracts/degrade-kind-parity.test.ts
import { expect, test } from 'bun:test';
import { DegradeKind as ContractDegradeKind } from '../../src/contracts/enums.ts';
import { DegradeKind as LedgerDegradeKind } from '../../src/reliability/ledger.ts';

test('contract DegradeKind values stay isomorphic with the reliability ledger', () => {
  const contract = Object.values(ContractDegradeKind).sort();
  const ledger = Object.values(LedgerDegradeKind).sort();
  expect(contract).toEqual(ledger);
});
```

(This test lives in `tests/`, not `src/contracts/`, so it MAY import both — that is exactly how we keep the wire mirror honest without the contract importing reliability.)

- [ ] **Step 6: Run the parity test to verify it passes**

Run: `bun test tests/contracts/degrade-kind-parity.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/contracts/dto.ts tests/contracts/dto.test.ts tests/contracts/degrade-kind-parity.test.ts
git commit -m "feat(contracts): add Run/Span/Degrade/ChatMessage DTO schemas + parity guard"
```

---

