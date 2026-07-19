## Task 6: Job store — `createJobStore` + `enqueue` + `getJob` (mappers, WAL pragmas)

**Files:**
- Create: `src/queue/store.ts`
- Create: `tests/queue/store-enqueue.test.ts`

**Interfaces:**
- Consumes: `Database` (`bun:sqlite`), `migrate` (`src/db/migrate.ts:6`), `JOB_MIGRATIONS` (Task 5), the Shared-contracts types (Task 4), `newRunId` (`src/run/run-id.ts:2`), `maxAttempts` (`src/reliability/config.ts:8`).
- Produces: `createJobStore(config: { path?: string }, deps: JobStoreDeps): JobStore` with `enqueue`/`getJob`/`close` implemented (the rest are added in Tasks 7–10 on the SAME returned object). `toJobRecord(raw)` mapper + `JobRowRaw` type. Follows `createSessionStore` (`src/session/store.ts:111`) exactly: `mkdirSync(dirname(dbPath))`, WAL/busy_timeout/foreign_keys pragmas, `migrate(db, JOB_MIGRATIONS)`.

- [ ] **Step 1: Write the failing test**

`tests/queue/store-enqueue.test.ts`:
```typescript
import { test, expect } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJobStore } from '../../src/queue/store.ts';
import { JobKind, JobPriority, JobStatus } from '../../src/queue/types.ts';

function tempStore() {
  const dir = mkdtempSync(join(tmpdir(), 'jobs-'));
  return createJobStore({ path: dir }, {});
}

test('enqueue returns a Queued JobRecord with defaults applied', () => {
  const store = tempStore();
  const job = store.enqueue({ kind: JobKind.Crew, payload: { name: 'x', input: 'go' } });
  expect(job.status).toBe(JobStatus.Queued);
  expect(job.priority).toBe(JobPriority.Normal);
  expect(job.attempts).toBe(0);
  expect(job.maxAttempts).toBeGreaterThan(0);
  expect(job.id).toMatch(/^job-/);
  expect(job.runId).toMatch(/^run-/); // store mints a runId when caller omits it
  expect(job.startedAt).toBeUndefined();
  store.close();
});

test('enqueue honours an explicit priority + caller-minted runId', () => {
  const store = tempStore();
  const job = store.enqueue({
    kind: JobKind.Chat,
    payload: { task: 'hi' },
    priority: JobPriority.High,
    runId: 'run-fixed-123',
  });
  expect(job.priority).toBe(JobPriority.High);
  expect(job.runId).toBe('run-fixed-123');
  store.close();
});

test('getJob round-trips payload JSON and returns undefined for a missing id', () => {
  const store = tempStore();
  const job = store.enqueue({ kind: JobKind.Workflow, payload: { def: 'wf', input: 'q' } });
  const got = store.getJob(job.id);
  expect(got?.payload).toEqual({ def: 'wf', input: 'q' });
  expect(store.getJob('job-nope')).toBeUndefined();
  store.close();
});
```

- [ ] **Step 2: Run — verify it fails**

`bun test tests/queue/store-enqueue.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement `src/queue/store.ts` (enqueue + getJob + mappers)**

```typescript
import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { migrate } from '../db/migrate.ts';
import { maxAttempts as defaultMaxAttempts } from '../reliability/config.ts';
import { newRunId } from '../run/run-id.ts';
import { JOB_MIGRATIONS } from './migrations.ts';
import {
  type JobInput,
  JobKind,
  JobPriority,
  type JobRecord,
  JobStatus,
} from './types.ts';

type JobRowRaw = {
  id: string;
  kind: string;
  payload: string;
  priority: string;
  status: string;
  attempts: number;
  max_attempts: number;
  created_at: number;
  updated_at: number;
  started_at: number | null;
  finished_at: number | null;
  available_at: number;
  run_id: string | null;
  result: string | null;
  error: string | null;
};

function toJobRecord(r: JobRowRaw): JobRecord {
  return {
    id: r.id,
    kind: r.kind as JobKind,
    payload: JSON.parse(r.payload) as unknown,
    priority: r.priority as JobPriority,
    status: r.status as JobStatus,
    attempts: r.attempts,
    maxAttempts: r.max_attempts,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    startedAt: r.started_at ?? undefined,
    finishedAt: r.finished_at ?? undefined,
    availableAt: r.available_at,
    runId: r.run_id ?? undefined,
    result: r.result === null ? undefined : (JSON.parse(r.result) as unknown),
    error: r.error ?? undefined,
  };
}

function encodeJobCursor(createdAt: number, id: string): string {
  return Buffer.from(`${createdAt}:${id}`).toString('base64url');
}

function decodeJobCursor(
  cursor: string,
): { createdAt: number; id: string } | undefined {
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    const idx = decoded.indexOf(':');
    if (idx === -1) return undefined;
    const createdAt = Number(decoded.slice(0, idx));
    const id = decoded.slice(idx + 1);
    if (!Number.isFinite(createdAt) || id.length === 0) return undefined;
    return { createdAt, id };
  } catch {
    return undefined;
  }
}

function newJobId(now = Date.now(), rand: () => number = Math.random): string {
  const ms = Math.floor(now).toString(36).padStart(9, '0');
  const r = Math.floor(rand() * 36 ** 6).toString(36).padStart(6, '0');
  return `job-${ms}-${r}`;
}

/** Parity seam mirroring `SessionStoreDeps` (`src/session/store.ts:102`). */
export type JobStoreDeps = Record<string, never>;

export function createJobStore(
  config: { path?: string },
  _deps: JobStoreDeps,
) {
  const dbPath = join(config.path ?? 'jobs', 'jobs.db');
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.run('PRAGMA journal_mode = WAL');
  db.run('PRAGMA busy_timeout = 5000');
  db.run('PRAGMA foreign_keys = ON');
  migrate(db, JOB_MIGRATIONS);

  function enqueue(input: JobInput): JobRecord {
    const at = Date.now();
    const id = newJobId(at);
    const runId = input.runId ?? newRunId();
    const priority = input.priority ?? JobPriority.Normal;
    const max = input.maxAttempts ?? defaultMaxAttempts();
    // INSERT OR IGNORE on the PK: a retried enqueue for the SAME id is a safe
    // no-op (mirrors upsertSession's idempotency, src/session/store.ts:130).
    const availableAt = input.availableAt ?? 0; // 0 = immediately claimable
    db.run(
      `INSERT OR IGNORE INTO jobs
       (id, kind, payload, priority, status, attempts, max_attempts,
        created_at, updated_at, started_at, finished_at, available_at,
        run_id, result, error)
       VALUES (?, ?, ?, ?, 'queued', 0, ?, ?, ?, NULL, NULL, ?, ?, NULL, NULL)`,
      [id, input.kind, JSON.stringify(input.payload), priority, max, at, at, availableAt, runId],
    );
    const row = getJob(id);
    if (!row) throw new Error('enqueue failed to persist job');
    return row;
  }

  function getJob(id: string): JobRecord | undefined {
    const r = db.query('SELECT * FROM jobs WHERE id = ?').get(id) as
      | JobRowRaw
      | undefined;
    return r ? toJobRecord(r) : undefined;
  }

  return {
    enqueue,
    getJob,
    close: (): void => db.close(),
    // claimNext / mark* / listJobs / reconcileOrphans added in Tasks 7-10.
    _db: db,
    _decodeJobCursor: decodeJobCursor,
    _encodeJobCursor: encodeJobCursor,
  };
}

export type JobStore = ReturnType<typeof createJobStore>;
```
(The `_db`/`_encode`/`_decode` fields are internal seams the next three tasks build the remaining closures against — Task 10 removes them from the public return once all methods land. They are underscore-prefixed and never referenced outside `src/queue/`.)

- [ ] **Step 4: Run — verify it passes**

`bun test tests/queue/store-enqueue.test.ts` → PASS (3 tests).

- [ ] **Step 5: Gate + commit**

```bash
bun run typecheck && bun run lint:file -- src/queue/store.ts tests/queue/store-enqueue.test.ts
git add src/queue/store.ts tests/queue/store-enqueue.test.ts
git commit -m "feat(queue): createJobStore enqueue+getJob + mappers (Slice 24 Incr 2)"
```

