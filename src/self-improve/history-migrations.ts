import type { Database } from 'bun:sqlite';
import type { Migration } from '../db/migrate.ts';

/**
 * Leaf module (Slice 32, Task 10) — deliberately imports NOTHING from
 * `../triggers/migrations.ts` or `./history.ts`. `EVAL_HISTORY_MIGRATIONS` is
 * appended to the `jobs.db` superset (`JOBS_DB_MIGRATIONS` in
 * `../triggers/migrations.ts`) rather than run standalone, because `migrate()`
 * (`../db/migrate.ts`) tracks progress with a single `PRAGMA user_version` per
 * DATABASE — an independent migration list opened over the same `jobs.db`
 * file would silently collide with whichever list already advanced
 * `user_version` past its own length. Keeping this list in its own leaf file
 * (instead of defining it in `history.ts`, which imports `JOBS_DB_MIGRATIONS`
 * from `../triggers/migrations.ts`) breaks the cycle that would otherwise
 * exist: `migrations.ts` -> `history.ts` -> `migrations.ts`.
 *
 * `eval_history` is append-only (Slice 32 §7.4): no migration here may ever
 * add an UPDATE/DELETE path, and the store built on top
 * (`createEvalHistoryStore`, `./history.ts`) exposes only `insert` + reads.
 */
export const EVAL_HISTORY_MIGRATIONS: Migration[] = [
  {
    name: 'init-eval-history',
    up: (db: Database) => {
      db.run(`CREATE TABLE IF NOT EXISTS eval_history (
        id             TEXT PRIMARY KEY,
        artifact_id    TEXT NOT NULL,
        model          TEXT NOT NULL,
        baseline_model TEXT,
        ts             INTEGER NOT NULL,
        passed         INTEGER NOT NULL,
        passed_count   INTEGER NOT NULL,
        total          INTEGER NOT NULL,
        regressed      INTEGER NOT NULL,
        per_case       TEXT NOT NULL,
        judge_model    TEXT NOT NULL,
        below_bar      INTEGER NOT NULL,
        reason         TEXT
      )`);
      // Backs listByArtifact's ts-DESC scan and latestPassing's filtered scan,
      // both keyed on artifact_id (mirrors idx_firings_list's shape).
      db.run(
        `CREATE INDEX IF NOT EXISTS idx_eval_history_artifact_ts
         ON eval_history (artifact_id, ts DESC)`,
      );
    },
  },
];
