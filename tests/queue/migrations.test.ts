import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { migrate } from '../../src/db/migrate.ts';
import { JOB_MIGRATIONS } from '../../src/queue/migrations.ts';

test('init-jobs creates the jobs table with the JobRecord columns', () => {
  const db = new Database(':memory:');
  const version = migrate(db, JOB_MIGRATIONS);
  expect(version).toBe(2);
  const cols = (
    db.query('PRAGMA table_info(jobs)').all() as { name: string }[]
  ).map((c) => c.name);
  expect(cols).toEqual([
    'id',
    'kind',
    'payload',
    'priority',
    'status',
    'attempts',
    'max_attempts',
    'created_at',
    'updated_at',
    'started_at',
    'finished_at',
    'available_at',
    'run_id',
    'result',
    'error',
    'retried_from',
  ]);
});

test('init-jobs is idempotent (re-migrate is a no-op)', () => {
  const db = new Database(':memory:');
  migrate(db, JOB_MIGRATIONS);
  expect(migrate(db, JOB_MIGRATIONS)).toBe(2);
});

test('add-retried-from advances user_version to 2', () => {
  const db = new Database(':memory:');
  expect(migrate(db, JOB_MIGRATIONS)).toBe(2);
});
