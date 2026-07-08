import { Database } from 'bun:sqlite';
import { afterEach, expect, test } from 'bun:test';
import { rmSync } from 'node:fs';
import { SqliteStore } from '../../src/memory/sqlite-store.ts';

const DB = '/tmp/mem-wal-test.db';
afterEach(() => {
  try {
    rmSync(DB);
    rmSync(`${DB}-wal`);
    rmSync(`${DB}-shm`);
  } catch {}
});

test('SqliteStore opens the database in WAL mode', () => {
  const s = new SqliteStore(DB);
  const mode = new Database(DB).query('PRAGMA journal_mode').get() as {
    journal_mode: string;
  };
  expect(mode.journal_mode.toLowerCase()).toBe('wal');
  s.close();
});
