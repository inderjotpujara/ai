import type { Database } from 'bun:sqlite';
import type { Migration } from '../db/migrate.ts';
import { JOB_MIGRATIONS } from '../queue/migrations.ts';
import { EVAL_HISTORY_MIGRATIONS } from '../self-improve/history-migrations.ts';

/**
 * Two migrations for `jobs.db`'s trigger tables (Slice 25, spec §7/§11).
 * `target_kind`/`target_payload`/`config` mirror `TriggerTarget`/`TriggerConfig`
 * as JSON TEXT (config) or plain TEXT (target_kind is a JobKind enum value).
 * `enabled` is stored as INTEGER (SQLite boolean convention, matches
 * `jobs.status` TEXT-enum precedent of storing enum values as-is elsewhere).
 */
export const TRIGGER_MIGRATIONS: Migration[] = [
  {
    name: 'init-triggers',
    up: (db: Database) => {
      db.run(`CREATE TABLE IF NOT EXISTS triggers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        target_kind TEXT NOT NULL,
        target_payload TEXT NOT NULL,
        config TEXT NOT NULL,
        origin TEXT NOT NULL,
        next_run_at INTEGER,
        last_fired_at INTEGER,
        token_hash TEXT,
        secret_ref TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(name, origin)
      )`);
      // Due-cron claim scan (scheduler.claimDueCron): enabled + type='cron' +
      // next_run_at<=now. token_hash index backs the constant-time webhook
      // lookup (/hooks/:token).
      db.run(`CREATE INDEX IF NOT EXISTS idx_triggers_due
              ON triggers(enabled, type, next_run_at)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_triggers_token
              ON triggers(token_hash)`);
    },
  },
  {
    name: 'init-trigger-firings',
    up: (db: Database) => {
      db.run(`CREATE TABLE IF NOT EXISTS trigger_firings (
        id TEXT PRIMARY KEY,
        trigger_id TEXT NOT NULL,
        fired_at INTEGER NOT NULL,
        job_id TEXT,
        run_id TEXT,
        outcome TEXT NOT NULL
      )`);
      // Keyset firings list (GET /api/triggers/:id/firings): newest-first per trigger.
      db.run(`CREATE INDEX IF NOT EXISTS idx_firings_list
              ON trigger_firings(trigger_id, fired_at)`);
    },
  },
];

/**
 * The AUTHORITATIVE ordered migration set for `jobs.db` when the trigger store
 * opens it — the queue's own migrations FIRST, then the trigger tables.
 *
 * WHY the combined list: `migrate()` (src/db/migrate.ts) tracks progress with
 * a single `PRAGMA user_version` per DATABASE, not a per-migration tracking
 * table. `jobs.db` is opened by BOTH `createJobStore` (which runs
 * `JOB_MIGRATIONS`, advancing `user_version` to `JOB_MIGRATIONS.length`) and
 * `createTriggerStore`. If the trigger store called
 * `migrate(db, TRIGGER_MIGRATIONS)` directly, it would read a `user_version`
 * already >= `TRIGGER_MIGRATIONS.length` (whenever the job store opened
 * first) and conclude its migrations are already applied — silently creating
 * NO tables. Running this superset instead means `migrate` always applies
 * only the not-yet-applied tail, regardless of which store opens the DB
 * first:
 *   - job store first: user_version -> JOB_MIGRATIONS.length, then this
 *     superset run applies just the TRIGGER_MIGRATIONS tail.
 *   - trigger store first: this superset run applies everything in one pass;
 *     the job store's later `migrate(db, JOB_MIGRATIONS)` then sees
 *     user_version already past its own length and is a no-op.
 *
 * `JOB_MIGRATIONS` (imported live, not copied) stays the authoritative jobs
 * list and the required strict prefix of this array; `createJobStore` is NOT
 * changed to use this superset.
 *
 * Slice 32 (Task 10) extends this same superset with `EVAL_HISTORY_MIGRATIONS`
 * — `eval_history` also lives in `jobs.db`, so it follows the identical
 * append-only-superset rule: appended AFTER `TRIGGER_MIGRATIONS`, never
 * reordered ahead of the existing entries (that would corrupt an existing
 * DB's `user_version` bookkeeping). `EVAL_HISTORY_MIGRATIONS` is defined in
 * the leaf module `../self-improve/history-migrations.ts` (not in
 * `../self-improve/history.ts`, which imports `JOBS_DB_MIGRATIONS` from this
 * file) so the two files don't import each other.
 */
export const JOBS_DB_MIGRATIONS: Migration[] = [
  ...JOB_MIGRATIONS,
  ...TRIGGER_MIGRATIONS,
  ...EVAL_HISTORY_MIGRATIONS,
];
