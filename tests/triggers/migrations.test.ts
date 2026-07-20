import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { migrate } from '../../src/db/migrate.ts';
import { JOB_MIGRATIONS } from '../../src/queue/migrations.ts';
import {
  JOBS_DB_MIGRATIONS,
  TRIGGER_MIGRATIONS,
} from '../../src/triggers/migrations.ts';

function tableNames(db: Database): string[] {
  return (
    db.query(`SELECT name FROM sqlite_master WHERE type='table'`).all() as {
      name: string;
    }[]
  ).map((r) => r.name);
}

test('JOBS_DB_MIGRATIONS is JOB_MIGRATIONS followed by TRIGGER_MIGRATIONS (strict prefix)', () => {
  expect(JOBS_DB_MIGRATIONS.length).toBe(
    JOB_MIGRATIONS.length + TRIGGER_MIGRATIONS.length,
  );
  expect(JOBS_DB_MIGRATIONS.slice(0, JOB_MIGRATIONS.length)).toEqual(
    JOB_MIGRATIONS,
  );
  expect(JOBS_DB_MIGRATIONS.slice(JOB_MIGRATIONS.length)).toEqual(
    TRIGGER_MIGRATIONS,
  );
});

test('open order 1: job store opens first (JOB_MIGRATIONS), then the trigger store runs the superset', () => {
  const db = new Database(':memory:');
  const jobVersion = migrate(db, JOB_MIGRATIONS); // simulate createJobStore opening first
  expect(jobVersion).toBe(JOB_MIGRATIONS.length);

  const supersetVersion = migrate(db, JOBS_DB_MIGRATIONS); // simulate createTriggerStore opening second
  expect(supersetVersion).toBe(JOBS_DB_MIGRATIONS.length);

  const tables = tableNames(db);
  expect(tables).toContain('jobs');
  expect(tables).toContain('triggers');
  expect(tables).toContain('trigger_firings');

  const row = db.query('PRAGMA user_version').get() as {
    user_version: number;
  };
  expect(row.user_version).toBe(JOBS_DB_MIGRATIONS.length);
});

test('open order 2: trigger store opens first (superset), then the job store opens (prefix) with no error', () => {
  const db = new Database(':memory:');
  const supersetVersion = migrate(db, JOBS_DB_MIGRATIONS); // simulate createTriggerStore opening first
  expect(supersetVersion).toBe(JOBS_DB_MIGRATIONS.length);

  // createJobStore is not changed — it still calls migrate(db, JOB_MIGRATIONS).
  // Because user_version is already past JOB_MIGRATIONS.length, this must be a
  // pure no-op: no error, no re-run, no version regression.
  const jobVersion = migrate(db, JOB_MIGRATIONS);
  expect(jobVersion).toBe(JOBS_DB_MIGRATIONS.length);

  const tables = tableNames(db);
  expect(tables).toContain('jobs');
  expect(tables).toContain('triggers');
  expect(tables).toContain('trigger_firings');

  const row = db.query('PRAGMA user_version').get() as {
    user_version: number;
  };
  expect(row.user_version).toBe(JOBS_DB_MIGRATIONS.length);
});

test('trigger tables land even after JOB_MIGRATIONS already advanced user_version', () => {
  const db = new Database(':memory:');
  migrate(db, JOB_MIGRATIONS); // simulate the job store opening first
  migrate(db, JOBS_DB_MIGRATIONS); // the trigger store's superset run
  const tables = tableNames(db);
  expect(tables).toContain('triggers');
  expect(tables).toContain('trigger_firings');
});

test('init-triggers creates the triggers table with the Trigger record columns', () => {
  const db = new Database(':memory:');
  migrate(db, JOBS_DB_MIGRATIONS);
  const cols = (
    db.query('PRAGMA table_info(triggers)').all() as { name: string }[]
  ).map((c) => c.name);
  expect(cols).toEqual([
    'id',
    'name',
    'type',
    'enabled',
    'target_kind',
    'target_payload',
    'config',
    'origin',
    'next_run_at',
    'last_fired_at',
    'token_hash',
    'secret_ref',
    'created_at',
    'updated_at',
  ]);
});

test('init-trigger-firings creates the trigger_firings table with the TriggerFiring record columns', () => {
  const db = new Database(':memory:');
  migrate(db, JOBS_DB_MIGRATIONS);
  const cols = (
    db.query('PRAGMA table_info(trigger_firings)').all() as {
      name: string;
    }[]
  ).map((c) => c.name);
  expect(cols).toEqual([
    'id',
    'trigger_id',
    'fired_at',
    'job_id',
    'run_id',
    'outcome',
  ]);
});

test('JOBS_DB_MIGRATIONS is idempotent (re-migrate is a no-op)', () => {
  const db = new Database(':memory:');
  migrate(db, JOBS_DB_MIGRATIONS);
  expect(migrate(db, JOBS_DB_MIGRATIONS)).toBe(JOBS_DB_MIGRATIONS.length);
});
