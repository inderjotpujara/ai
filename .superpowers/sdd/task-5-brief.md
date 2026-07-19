## Task 5: Jobs migration — `'init-jobs'`

**Files:**
- Create: `src/queue/migrations.ts`
- Create: `tests/queue/migrations.test.ts`

**Interfaces:**
- Consumes: `Migration` (`src/db/migrate.ts:3`), `migrate` (`src/db/migrate.ts:6`), `Database` (`bun:sqlite`).
- Produces: `JOB_MIGRATIONS: Migration[]` — one migration `'init-jobs'` creating the `jobs` table + a claim index. Mirrors `SESSION_MIGRATIONS` (`src/session/migrations.ts:18`).

- [ ] **Step 1: Write the failing test**

`tests/queue/migrations.test.ts`:
```typescript
import { test, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { migrate } from '../../src/db/migrate.ts';
import { JOB_MIGRATIONS } from '../../src/queue/migrations.ts';

test('init-jobs creates the jobs table with the JobRecord columns', () => {
  const db = new Database(':memory:');
  const version = migrate(db, JOB_MIGRATIONS);
  expect(version).toBe(1);
  const cols = (
    db.query('PRAGMA table_info(jobs)').all() as { name: string }[]
  ).map((c) => c.name);
  expect(cols).toEqual([
    'id', 'kind', 'payload', 'priority', 'status', 'attempts', 'max_attempts',
    'created_at', 'updated_at', 'started_at', 'finished_at', 'available_at',
    'run_id', 'result', 'error',
  ]);
});

test('init-jobs is idempotent (re-migrate is a no-op)', () => {
  const db = new Database(':memory:');
  migrate(db, JOB_MIGRATIONS);
  expect(migrate(db, JOB_MIGRATIONS)).toBe(1);
});
```

- [ ] **Step 2: Run — verify it fails**

`bun test tests/queue/migrations.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement `src/queue/migrations.ts`**

```typescript
import type { Database } from 'bun:sqlite';
import type { Migration } from '../db/migrate.ts';

/**
 * One migration for `jobs.db`: the durable task queue (spec D6). Mirrors
 * `src/session/migrations.ts`'s shape. `payload`/`result` are JSON TEXT.
 * `status`/`kind`/`priority` are TEXT holding the enum VALUES. The composite
 * index backs `claimNext`'s priority-then-FIFO scan (High before Normal, then
 * oldest created_at first) over Queued rows only.
 */
export const JOB_MIGRATIONS: Migration[] = [
  {
    name: 'init-jobs',
    up: (db: Database) => {
      db.run(`CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        payload TEXT NOT NULL,
        priority TEXT NOT NULL DEFAULT 'normal',
        status TEXT NOT NULL DEFAULT 'queued',
        attempts INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        started_at INTEGER,
        finished_at INTEGER,
        available_at INTEGER NOT NULL DEFAULT 0,
        run_id TEXT,
        result TEXT,
        error TEXT
      )`);
      // `available_at` is the epoch-ms floor before which a Queued row is NOT
      // claimable (0 = immediately). Retry backoff (markFailed, Task 8) sets it
      // forward so claimNext (Task 7) actually spaces re-claims under
      // concurrency — the delay is enforced durably in the DB, not by a worker
      // sleeping on a held slot.
      // Claim scan: filter status='queued' AND available_at<=now, order
      // High-priority first then oldest created_at. Priority is stored as its
      // enum text; 'high' < 'normal' lexically, so a plain ASC on
      // (priority, created_at) already yields High-before-Normal, oldest-first
      // — no CASE needed. `available_at` is a residual filter on the same scan.
      db.run(
        `CREATE INDEX IF NOT EXISTS idx_jobs_claim
         ON jobs(status, priority, created_at)`,
      );
    },
  },
];
```

- [ ] **Step 4: Run — verify it passes**

`bun test tests/queue/migrations.test.ts` → PASS. (Note the deliberate reliance on `'high' < 'normal'` lexical order — the test in Task 7 pins the ordering behaviourally so this cleverness can never silently regress.)

- [ ] **Step 5: Gate + commit**

```bash
bun run typecheck && bun run lint:file -- src/queue/migrations.ts tests/queue/migrations.test.ts
git add src/queue/migrations.ts tests/queue/migrations.test.ts
git commit -m "feat(queue): init-jobs migration (Slice 24 Incr 2)"
```

