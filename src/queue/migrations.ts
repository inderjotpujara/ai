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
