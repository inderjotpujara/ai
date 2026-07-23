import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { migrate } from '../db/migrate.ts';
import { JOBS_DB_MIGRATIONS } from '../triggers/migrations.ts';
import type { EvalCaseResult } from '../verified-build/types.ts';

export { EVAL_HISTORY_MIGRATIONS } from './history-migrations.ts';

/**
 * One append-only row per re-eval verdict (Slice 32 §7.4) — the durable
 * record `reevalArtifact` (`./reeval.ts`) produces on each pull-event/sweep
 * check. `baselineModel` and `reason` are absent (not persisted) unless the
 * caller had them: an entry recorded before a baseline was known, or a
 * passing/non-demoted entry with nothing to explain, carries neither.
 */
export type EvalHistoryRow = {
  id: string;
  artifactId: string;
  model: string;
  baselineModel?: string;
  ts: number;
  passed: boolean;
  passedCount: number;
  total: number;
  regressed: boolean;
  perCase: EvalCaseResult[];
  judgeModel: string;
  belowBar: boolean;
  reason?: string;
};

type EvalHistoryRowRaw = {
  id: string;
  artifact_id: string;
  model: string;
  baseline_model: string | null;
  ts: number;
  passed: number;
  passed_count: number;
  total: number;
  regressed: number;
  per_case: string;
  judge_model: string;
  below_bar: number;
  reason: string | null;
};

function toEvalHistoryRow(r: EvalHistoryRowRaw): EvalHistoryRow {
  return {
    id: r.id,
    artifactId: r.artifact_id,
    model: r.model,
    baselineModel: r.baseline_model ?? undefined,
    ts: r.ts,
    passed: r.passed === 1,
    passedCount: r.passed_count,
    total: r.total,
    regressed: r.regressed === 1,
    perCase: JSON.parse(r.per_case) as EvalCaseResult[],
    judgeModel: r.judge_model,
    belowBar: r.below_bar === 1,
    reason: r.reason ?? undefined,
  };
}

/**
 * `eval_history` is APPEND-ONLY: `insert` + two read accessors, and
 * deliberately no `update`/`delete` — a re-eval verdict is a historical fact,
 * never revised in place (Slice 32 §7.4). Do not add either method here.
 */
export type EvalHistoryStore = {
  insert(row: EvalHistoryRow): void;
  /** All rows for one artifact, newest-first (`ts` DESC). */
  listByArtifact(artifactId: string): EvalHistoryRow[];
  /** The newest row that both passed and did not regress, or `undefined` if
   *  the artifact has never had one. */
  latestPassing(artifactId: string): EvalHistoryRow | undefined;
  close(): void;
};

/**
 * Mirrors `createSessionStore`'s factory shape (`../session/store.ts`) and
 * its WAL/busy_timeout/foreign_keys pragma trio, but opens the SAME `jobs.db`
 * the queue + trigger stores use and runs the FULL `JOBS_DB_MIGRATIONS`
 * superset (never an independent migration list) — see the R3 note on
 * `JOBS_DB_MIGRATIONS` in `../triggers/migrations.ts`.
 */
export function createEvalHistoryStore(config: {
  path?: string;
}): EvalHistoryStore {
  const dbPath = join(config.path ?? 'jobs', 'jobs.db');
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.run('PRAGMA journal_mode = WAL');
  db.run('PRAGMA busy_timeout = 5000');
  db.run('PRAGMA foreign_keys = ON');
  migrate(db, JOBS_DB_MIGRATIONS);

  function insert(row: EvalHistoryRow): void {
    db.run(
      `INSERT INTO eval_history
       (id, artifact_id, model, baseline_model, ts, passed, passed_count,
        total, regressed, per_case, judge_model, below_bar, reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id,
        row.artifactId,
        row.model,
        row.baselineModel ?? null,
        row.ts,
        row.passed ? 1 : 0,
        row.passedCount,
        row.total,
        row.regressed ? 1 : 0,
        JSON.stringify(row.perCase),
        row.judgeModel,
        row.belowBar ? 1 : 0,
        row.reason ?? null,
      ],
    );
  }

  function listByArtifact(artifactId: string): EvalHistoryRow[] {
    const rows = db
      .query(
        `SELECT * FROM eval_history WHERE artifact_id = ? ORDER BY ts DESC`,
      )
      .all(artifactId) as EvalHistoryRowRaw[];
    return rows.map(toEvalHistoryRow);
  }

  function latestPassing(artifactId: string): EvalHistoryRow | undefined {
    const r = db
      .query(
        `SELECT * FROM eval_history
         WHERE artifact_id = ? AND passed = 1 AND regressed = 0
         ORDER BY ts DESC LIMIT 1`,
      )
      .get(artifactId) as EvalHistoryRowRaw | undefined;
    return r ? toEvalHistoryRow(r) : undefined;
  }

  return {
    insert,
    listByArtifact,
    latestPassing,
    close: (): void => db.close(),
  };
}
