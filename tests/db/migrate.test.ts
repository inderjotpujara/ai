import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { migrate } from '../../src/db/migrate.ts';

test('migrate applies pending migrations once and is idempotent', () => {
  const db = new Database(':memory:');
  const ms = [
    { name: 'init', up: (d: Database) => d.run('CREATE TABLE t (id INTEGER)') },
    {
      name: 'add-col',
      up: (d: Database) => d.run('ALTER TABLE t ADD COLUMN v TEXT'),
    },
  ];
  expect(migrate(db, ms)).toBe(2);
  expect(migrate(db, ms)).toBe(2); // no-op second time
  const cols = db.query('PRAGMA table_info(t)').all() as { name: string }[];
  expect(cols.map((c) => c.name)).toEqual(['id', 'v']);
});
