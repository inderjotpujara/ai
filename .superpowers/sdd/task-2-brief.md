## Task 2: `RunListQuery.origin` facet

**Files:**
- Modify: `src/contracts/requests.ts` (`RunListQuerySchema`)
- Modify: `src/server/runs/list.ts` (thread the facet into the run-list filter)
- Test: `tests/contracts/run-list-query.test.ts` (new), `tests/server/runs/list-origin.test.ts` (new)

**Interfaces:**
- Consumes: `RunListQuerySchema` (`src/contracts/requests.ts:80`), `RunOrigin` (`src/contracts/enums.ts:11`), `handleRunList` (`src/server/runs/list.ts`).
- Produces: `RunListQuerySchema.origin: z.enum(RunOrigin).optional()`; `handleRunList` passes `origin` to its run-store list filter so `?origin=daemon` returns only `RunOrigin.Daemon` runs (the Jobs-tab `runId` deep-link filter).

- [ ] **Step 1: Write the failing contract test** — `tests/contracts/run-list-query.test.ts`:
```typescript
import { test, expect } from 'bun:test';
import { RunListQuerySchema } from '../../src/contracts/requests.ts';
import { RunOrigin } from '../../src/contracts/enums.ts';

test('RunListQuery accepts an origin facet', () => {
  expect(RunListQuerySchema.parse({ origin: 'daemon' }).origin).toBe(RunOrigin.Daemon);
});
test('RunListQuery origin is optional and rejects an unknown value', () => {
  expect(RunListQuerySchema.parse({}).origin).toBeUndefined();
  expect(() => RunListQuerySchema.parse({ origin: 'nope' })).toThrow();
});
```

- [ ] **Step 2: Run — verify it fails** — `bun test tests/contracts/run-list-query.test.ts` → FAIL.

- [ ] **Step 3: Implement** — in `src/contracts/requests.ts`, add to `RunListQuerySchema` (after `kind`):
```typescript
  origin: z.enum(RunOrigin).optional(),
```
Add `RunOrigin` to the enums import at the top of the file. In `src/server/runs/list.ts`, read `query.origin` and pass it into the same run-store filter the `kind` facet uses (locate the existing list-filter call and add an `origin` predicate — daemon-list filtering matches on the run dir's `origin` marker, same source `mapRunToDto` reads). If the run store's list function has no `origin` param yet, filter the mapped `RunListItemDTO[]` by `item.origin === query.origin` before pagination (mirroring how a purely in-mapper facet would work) — keep it a straight equality filter.

- [ ] **Step 4: Write + run the server test** — `tests/server/runs/list-origin.test.ts`: seed two run dirs (one daemon-origin, one manual — reuse the run-fixture helper the existing `tests/server/runs/*` tests use), call `handleRunList(new URLSearchParams('origin=daemon'), deps)`, assert only the daemon run returns. Run → PASS.

- [ ] **Step 5: Gate + commit**
```bash
bun run typecheck && bun run lint:file -- src/contracts/requests.ts src/server/runs/list.ts tests/contracts/run-list-query.test.ts tests/server/runs/list-origin.test.ts
git add src/contracts/requests.ts src/server/runs/list.ts tests/contracts/run-list-query.test.ts tests/server/runs/list-origin.test.ts
git commit -m "feat(contracts): RunListQuery.origin facet for daemon-run filtering (Slice 25b Incr 1)"
```

