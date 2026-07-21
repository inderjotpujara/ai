### Task 5: Trigger tables migration

**Files:**
- Create: `src/triggers/migrations.ts`
- Test: `tests/triggers/migrations.test.ts`

**Interfaces:**
- Consumes: `JOB_MIGRATIONS` from `src/queue/migrations.ts`; `migrate`, `Migration` from `src/db/migrate.ts`.
- Produces: `export const TRIGGER_MIGRATIONS: Migration[]` (two entries) and `export const JOBS_DB_MIGRATIONS: Migration[] = [...JOB_MIGRATIONS, ...TRIGGER_MIGRATIONS]`.

> **CRITICAL — why the combined list (do not skip this).** `migrate()` tracks progress with a single `PRAGMA user_version` **per database**, not a per-migration tracking table. `jobs.db` is opened by BOTH `createJobStore` (which runs `JOB_MIGRATIONS`, advancing `user_version` to 3) and, in this slice, `createTriggerStore`. If the trigger store called `migrate(db, TRIGGER_MIGRATIONS)` it would read `user_version = 3`, conclude both its migrations are already applied, and **silently create no tables**. The trigger store MUST run the SUPERSET `JOBS_DB_MIGRATIONS` (`JOB_MIGRATIONS` first, then `TRIGGER_MIGRATIONS`) so `migrate` applies only the not-yet-applied tail regardless of which store opened the DB first. `JOB_MIGRATIONS` stays the authoritative jobs list; `createJobStore` is NOT changed.

- [ ] **Step 1: Write the failing test** — running `JOBS_DB_MIGRATIONS` creates both tables and is idempotent when `JOB_MIGRATIONS` already ran:

```ts
import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { migrate } from '../../src/db/migrate.ts';
import { JOB_MIGRATIONS } from '../../src/queue/migrations.ts';
import { JOBS_DB_MIGRATIONS } from '../../src/triggers/migrations.ts';

test('trigger tables land even after JOB_MIGRATIONS already advanced user_version', () => {
  const db = new Database(':memory:');
  migrate(db, JOB_MIGRATIONS); // simulate the job store opening first
  migrate(db, JOBS_DB_MIGRATIONS); // the trigger store's superset run
  const tables = db
    .query(`SELECT name FROM sqlite_master WHERE type='table'`)
    .all()
    .map((r) => (r as { name: string }).name);
  expect(tables).toContain('triggers');
  expect(tables).toContain('trigger_firings');
});
```

- [ ] **Step 2: Run test to verify it fails** → FAIL (module missing).
- [ ] **Step 3: Write minimal implementation** — `src/triggers/migrations.ts`:

```ts
import type { Database } from 'bun:sqlite';
import type { Migration } from '../db/migrate.ts';
import { JOB_MIGRATIONS } from '../queue/migrations.ts';

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

/** The AUTHORITATIVE ordered migration set for `jobs.db` when the trigger store
 *  opens it — the queue's own migrations FIRST, then the trigger tables. Run
 *  this (never a bare `migrate(db, TRIGGER_MIGRATIONS)`) so the single
 *  `PRAGMA user_version` counter stays consistent no matter which store opened
 *  the DB first (see this file's header note). */
export const JOBS_DB_MIGRATIONS: Migration[] = [
  ...JOB_MIGRATIONS,
  ...TRIGGER_MIGRATIONS,
];
```

- [ ] **Step 4: Run test to verify it passes** → PASS.
- [ ] **Step 5: Gate + commit** — `bun run typecheck && bun run lint:file -- src/triggers/migrations.ts tests/triggers/migrations.test.ts`.

```bash
git add src/triggers/migrations.ts tests/triggers/migrations.test.ts
git commit -m "feat(triggers): trigger + trigger_firings tables (combined jobs.db migration list)"
```

*Model: Opus (the `user_version` interaction is the single most silent-failure-prone decision in the slice; reviewer confirms the superset ordering and that `createJobStore` is untouched).*

