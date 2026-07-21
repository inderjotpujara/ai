### Task 3: Trigger DTOs + request/response schemas

**Files:**
- Modify: `src/contracts/dto.ts` (append after `JobDtoSchema`), `src/contracts/requests.ts` (append at end)
- Test: `tests/contracts/trigger-dto.test.ts`

**Interfaces:**
- Consumes: `TriggerTypeWire`, `TriggerOriginWire`, `TriggerOutcomeWire`, `JobKindWire`, `JobStatusWire` from `./enums.ts`; `JobLaunchResponseSchema` reused for fire responses (`{ jobId, runId }`).
- Produces (dto.ts):
  - `TriggerDtoSchema` / `TriggerDTO`: `{ id, name, type: z.enum(TriggerTypeWire), enabled: z.boolean(), target: z.object({ kind: z.enum(JobKindWire), payload: z.unknown() }), config: z.unknown(), origin: z.enum(TriggerOriginWire), nextRunAt: z.number().optional(), lastFiredAt: z.number().optional(), createdAt: z.number(), updatedAt: z.number(), webhookUrl: z.string().optional() }` — **NEVER** a token/secret field.
  - `TriggerFiringDtoSchema` / `TriggerFiringDTO`: `{ id, triggerId, firedAt: z.number(), jobId: z.string().optional(), runId: z.string().optional(), outcome: z.enum(TriggerOutcomeWire) }`.
- Produces (requests.ts):
  - Per-type config schemas: `CronConfigSchema` (`{ schedule: z.string().min(1).max(200), timezone: z.string().max(64).optional(), catchUp: z.boolean().optional(), allowOverlap: z.boolean().optional() }`), `WebhookConfigSchema` (`{ hmac: z.boolean().optional() }`), `FileConfigSchema` (`{ path: z.string().min(1).max(4096), events: z.array(z.enum(['add','change'])).optional() }`), `JobChainConfigSchema` (`{ onKind: z.enum(JobKindWire).optional(), onName: z.string().max(200).optional(), onStatus: z.enum(['done','failed']) }`).
  - `TriggerCreateRequestSchema` / `TriggerCreateRequest`: `{ name: z.string().min(1).max(120), type: z.enum(TriggerTypeWire), target: z.object({ kind: z.enum(JobKindWire), payload: z.unknown() }), config: z.unknown(), enabled: z.boolean().optional() }` (config validated per-type in the handler, Task 23).
  - `TriggerPatchRequestSchema` / `TriggerPatchRequest`: `{ enabled: z.boolean().optional(), target: z.object({ kind: z.enum(JobKindWire), payload: z.unknown() }).optional(), config: z.unknown().optional() }`.
  - `TriggerCreateResponseSchema` / `TriggerCreateResponse`: `{ trigger: TriggerDtoSchema, webhookToken: z.string().optional(), webhookUrl: z.string().optional() }` — the raw path token is transmitted EXACTLY ONCE here (the `DevicePairResponseSchema` precedent).
  - `TriggerListResponseSchema` / `TriggerListResponse`: `{ items: z.array(TriggerDtoSchema) }` (plain array — small set, no cursor, the `CrewListResponseSchema` idiom).
  - `TriggerFiringListQuerySchema` / `TriggerFiringListQuery`: `{ cursor: z.string().optional(), limit: z.coerce.number().int().positive().max(200).default(25) }`.
  - `TriggerFiringListResponseSchema` / `TriggerFiringListResponse`: `{ items: z.array(TriggerFiringDtoSchema), nextCursor: z.string().optional(), total: z.number() }` (keyset — `JobListResponseSchema` shape).

- [ ] **Step 1: Write the failing test** — round-trip a `TriggerDtoSchema` value and reject a bad `outcome`:

```ts
import { expect, test } from 'bun:test';
import {
  TriggerDtoSchema,
  TriggerFiringDtoSchema,
} from '../../src/contracts/dto.ts';

test('TriggerDtoSchema round-trips a cron trigger', () => {
  const dto = {
    id: 't-1', name: 'nightly', type: 'cron', enabled: true,
    target: { kind: 'workflow', payload: { input: 'x' } },
    config: { schedule: '0 3 * * *' }, origin: 'console',
    nextRunAt: 1, createdAt: 1, updatedAt: 1,
  };
  expect(TriggerDtoSchema.parse(dto)).toMatchObject({ id: 't-1', type: 'cron' });
});
test('TriggerFiringDtoSchema rejects an unknown outcome', () => {
  expect(() =>
    TriggerFiringDtoSchema.parse({
      id: 'f1', triggerId: 't-1', firedAt: 1, outcome: 'exploded',
    }),
  ).toThrow();
});
```

- [ ] **Step 2: Run test to verify it fails** — `bun run test -- -t "TriggerDtoSchema round-trips"` → FAIL.
- [ ] **Step 3: Write minimal implementation** — add the schemas from the Produces block to `dto.ts` and `requests.ts`. Import the new wire enums; reuse `JobLaunchResponseSchema` where the plan later needs a `{ jobId, runId }` fire response (no new schema for that).
- [ ] **Step 4: Run test to verify it passes** → PASS.
- [ ] **Step 5: Gate + commit** — `bun run typecheck && bun run lint:file -- src/contracts/dto.ts src/contracts/requests.ts tests/contracts/trigger-dto.test.ts`.

```bash
git add src/contracts/dto.ts src/contracts/requests.ts tests/contracts/trigger-dto.test.ts
git commit -m "feat(contracts): trigger DTOs + request/response schemas"
```

*Model: Sonnet.*

