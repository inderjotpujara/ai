### Task 3: `RunListQuery` + `RunListResponse` request/response schemas

**Files:**
- Modify: `src/contracts/requests.ts`
- Test: `tests/contracts/requests.test.ts` (extend)

**Interfaces:**
- Consumes: `RunListItemDtoSchema` (Task 2) — imported from `./dto.ts` (a `./` sibling, allowed by the isomorphism guard).
- Produces:
  - `RunListQuerySchema` → `RunListQuery` = `{ search?: string, outcome?: string, degraded?: boolean, limit: number, cursor?: string }`. Query values arrive as strings, so `limit` uses `z.coerce.number()` with `.default(25)` and `degraded` coerces `'true'/'false'` → boolean. (Coercion lives in the contract but stays zod-only — no forbidden import.)
  - `RunListResponseSchema` → `RunListResponse` = `{ items: RunListItemDTO[], nextCursor?: string, total: number }`.

- [ ] **Step 1: Write the failing test** — append to `tests/contracts/requests.test.ts`:

```ts
import {
  RunListQuerySchema,
  RunListResponseSchema,
} from '../../src/contracts/requests.ts';
import { RunLifecycle, RunOrigin } from '../../src/contracts/enums.ts';

test('RunListQuery coerces string query params and defaults limit', () => {
  const parsed = RunListQuerySchema.parse({
    search: 'qwen',
    outcome: 'answer',
    degraded: 'true',
    limit: '10',
  });
  expect(parsed).toEqual({
    search: 'qwen',
    outcome: 'answer',
    degraded: true,
    limit: 10,
  });
});

test('RunListQuery applies the default limit when omitted', () => {
  const parsed = RunListQuerySchema.parse({});
  expect(parsed.limit).toBe(25);
  expect(parsed.degraded).toBeUndefined();
});

test('RunListResponse validates items + pagination', () => {
  const parsed = RunListResponseSchema.parse({
    items: [
      {
        id: 'run-1',
        startMs: 1,
        durationMs: 2,
        outcome: 'answer',
        lifecycle: RunLifecycle.Done,
        origin: RunOrigin.Manual,
        models: [],
        degraded: false,
        spanCount: 1,
      },
    ],
    nextCursor: 'abc',
    total: 1,
  });
  expect(parsed.items).toHaveLength(1);
  expect(parsed.nextCursor).toBe('abc');
});
```

- [ ] **Step 2: Run to fail** — `bun test --path-ignore-patterns 'web/**' tests/contracts/requests.test.ts` → FAIL (schemas not exported).

- [ ] **Step 3: Minimal impl** — append to `src/contracts/requests.ts` (add `RunListItemDtoSchema` to the existing `./dto.ts`? there is no such import yet — add one):

```ts
import { RunListItemDtoSchema } from './dto.ts';

/** `GET /api/runs?search=&outcome=&degraded=&limit=&cursor=` query. Values are
 *  raw query strings, so `limit`/`degraded` coerce; `limit` carries a default. */
export const RunListQuerySchema = z.object({
  search: z.string().optional(),
  outcome: z.string().optional(),
  degraded: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
  limit: z.coerce.number().int().positive().max(200).default(25),
  cursor: z.string().optional(),
});
export type RunListQuery = z.infer<typeof RunListQuerySchema>;

/** `GET /api/runs` response — a page of run summaries + a cursor when more remain. */
export const RunListResponseSchema = z.object({
  items: z.array(RunListItemDtoSchema),
  nextCursor: z.string().optional(),
  total: z.number(),
});
export type RunListResponse = z.infer<typeof RunListResponseSchema>;
```

- [ ] **Step 4: Run to pass** — `bun test --path-ignore-patterns 'web/**' tests/contracts` → PASS (incl. `isomorphic.test.ts`: the new `./dto.ts` import is a `./` sibling, allowed).

- [ ] **Step 5: Gate + commit**

```bash
bun run typecheck && bun run lint:file -- "src/contracts/requests.ts" "tests/contracts/requests.test.ts"
git add src/contracts/requests.ts tests/contracts/requests.test.ts
git commit -m "feat(contracts): RunListQuery + RunListResponse schemas for the Runs list endpoint"
```

---

## Layer ② — The span→DTO mapper

