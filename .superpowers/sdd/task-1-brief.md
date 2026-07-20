## Task 1: `JobDto.availableAt` + `JobDto.retriedFrom` + `retried_from` column + store lineage plumbing

**Files:**
- Modify: `src/contracts/dto.ts` (add two fields to `JobDtoSchema`)
- Modify: `src/queue/migrations.ts` (append an `'add-retried-from'` migration)
- Modify: `src/queue/types.ts` (`JobRecord.retriedFrom`, `JobInput.retriedFrom`)
- Modify: `src/queue/store.ts` (`JobRowRaw.retried_from`, `toJobRecord`, `enqueue` INSERT)
- Test: `tests/queue/migrations.test.ts` (extend), `tests/queue/store-lineage.test.ts` (new), `tests/contracts/job-dto.test.ts` (extend or new)

**Interfaces:**
- Consumes: `JobDtoSchema` (`src/contracts/dto.ts:131`), `JOB_MIGRATIONS` (`src/queue/migrations.ts`), `JobRecord`/`JobInput` (`src/queue/types.ts`), `createJobStore` (`src/queue/store.ts:112`).
- Produces: `JobDtoSchema` with `availableAt: z.number()` + `retriedFrom: z.string().nullable()` (Shared contracts); `JobRecord.retriedFrom: string | null`; `JobInput.retriedFrom?: string`; `JobStore.enqueue` persists `retried_from`. `toJobDto` (`src/server/jobs/map.ts`) is an unchanged passthrough `JobDtoSchema.parse(record)` — it works once `JobRecord` carries `availableAt` (already there) + `retriedFrom`.

- [ ] **Step 1: Write the failing store test** — `tests/queue/store-lineage.test.ts`:
```typescript
import { test, expect } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJobStore } from '../../src/queue/store.ts';
import { JobKind } from '../../src/queue/types.ts';

function tempStore() {
  return createJobStore({ path: mkdtempSync(join(tmpdir(), 'jobs-')) }, {});
}

test('a fresh job has retriedFrom null', () => {
  const store = tempStore();
  const job = store.enqueue({ kind: JobKind.Crew, payload: { input: 'go' } });
  expect(job.retriedFrom).toBeNull();
  expect(store.getJob(job.id)?.retriedFrom).toBeNull();
  store.close();
});

test('enqueue stamps retriedFrom when supplied (lineage)', () => {
  const store = tempStore();
  const original = store.enqueue({ kind: JobKind.Crew, payload: 1 });
  const retry = store.enqueue({
    kind: JobKind.Crew,
    payload: 1,
    retriedFrom: original.id,
  });
  expect(retry.retriedFrom).toBe(original.id);
  expect(store.getJob(retry.id)?.retriedFrom).toBe(original.id);
  store.close();
});
```

- [ ] **Step 2: Run — verify it fails** — `bun test tests/queue/store-lineage.test.ts` → FAIL (`retriedFrom` is `undefined`, not `null`, and `JobInput` has no `retriedFrom`).

- [ ] **Step 3: Implement the migration** — append to `JOB_MIGRATIONS` in `src/queue/migrations.ts` (AFTER the existing `'init-jobs'` entry, so `user_version` advances to 2):
```typescript
  {
    name: 'add-retried-from',
    up: (db: Database) => {
      // §11 lineage: a retried job records the id of the job it re-runs, so the
      // Jobs drawer can show "retry of job X" and back-link. Nullable — original
      // (non-retry) jobs have no lineage.
      db.run(`ALTER TABLE jobs ADD COLUMN retried_from TEXT`);
    },
  },
```

- [ ] **Step 4: Implement the type + store changes.**
  - `src/queue/types.ts`: add `retriedFrom: string | null;` to `JobRecord` (after `error`), and `retriedFrom?: string;` to `JobInput` (after `runId`).
  - `src/queue/store.ts`: add `retried_from: string | null;` to `JobRowRaw`; in `toJobRecord` add `retriedFrom: r.retried_from,` (SQLite yields `string | null` directly — no `?? undefined` since the DTO field is `nullable`, not optional); change the `enqueue` INSERT to include the column:
```typescript
    db.run(
      `INSERT OR IGNORE INTO jobs
       (id, kind, payload, priority, status, attempts, max_attempts,
        created_at, updated_at, started_at, finished_at, available_at,
        run_id, result, error, retried_from)
       VALUES (?, ?, ?, ?, 'queued', 0, ?, ?, ?, NULL, NULL, ?, ?, NULL, NULL, ?)`,
      [
        id,
        input.kind,
        JSON.stringify(input.payload),
        priority,
        max,
        at,
        at,
        availableAt,
        runId,
        input.retriedFrom ?? null,
      ],
    );
```

- [ ] **Step 5: Extend the migration test** — in `tests/queue/migrations.test.ts`, update the `init-jobs` column assertion's expected version to `2` and add `'retried_from'` to the expected `cols` array (last element); add:
```typescript
test('add-retried-from advances user_version to 2', () => {
  const db = new Database(':memory:');
  expect(migrate(db, JOB_MIGRATIONS)).toBe(2);
});
```

- [ ] **Step 6: Extend the contract** — in `src/contracts/dto.ts`, add to `JobDtoSchema` (after `error`):
```typescript
  availableAt: z.number(),
  retriedFrom: z.string().nullable(),
```
Add a round-trip assertion in `tests/contracts/job-dto.test.ts` (create if absent):
```typescript
import { test, expect } from 'bun:test';
import { JobDtoSchema } from '../../src/contracts/dto.ts';

test('JobDtoSchema round-trips availableAt + nullable retriedFrom', () => {
  const dto = {
    id: 'job-1', kind: 'crew', payload: { input: 'x' }, priority: 'normal',
    status: 'queued', attempts: 0, maxAttempts: 3, createdAt: 1, updatedAt: 1,
    availableAt: 0, retriedFrom: null,
  };
  expect(JobDtoSchema.parse(dto).retriedFrom).toBeNull();
  expect(JobDtoSchema.parse({ ...dto, retriedFrom: 'job-0' }).retriedFrom).toBe('job-0');
});
```

- [ ] **Step 7: Run — verify green** — `bun test tests/queue/store-lineage.test.ts tests/queue/migrations.test.ts tests/contracts/job-dto.test.ts` → PASS.

- [ ] **Step 8: Gate + commit**
```bash
bun run typecheck && bun run lint:file -- src/contracts/dto.ts src/queue/migrations.ts src/queue/types.ts src/queue/store.ts tests/queue/store-lineage.test.ts tests/queue/migrations.test.ts tests/contracts/job-dto.test.ts
git add src/contracts/dto.ts src/queue/migrations.ts src/queue/types.ts src/queue/store.ts tests/queue/
git commit -m "feat(queue): JobDto availableAt + retriedFrom lineage column (Slice 25b Incr 1)"
```

