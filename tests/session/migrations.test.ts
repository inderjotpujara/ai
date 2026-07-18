import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrate } from '../../src/db/migrate.ts';
import { SESSION_MIGRATIONS } from '../../src/session/migrations.ts';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'session-migrations-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

test('migrate() applies init-sessions-and-messages from an empty db', () => {
  const db = new Database(join(dir, 'test.db'));
  const version = migrate(db, SESSION_MIGRATIONS);
  expect(version).toBe(1);

  const tables = db
    .query("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all() as { name: string }[];
  const names = tables.map((t) => t.name);
  expect(names).toContain('sessions');
  expect(names).toContain('messages');
  db.close();
});

test('migrate() is idempotent — re-running against an already-migrated db is a no-op', () => {
  const dbPath = join(dir, 'test.db');
  const db1 = new Database(dbPath);
  migrate(db1, SESSION_MIGRATIONS);
  db1.close();

  const db2 = new Database(dbPath);
  const version = migrate(db2, SESSION_MIGRATIONS);
  expect(version).toBe(1); // user_version already 1 → the migration loop runs zero iterations
  db2.close();
});

test("sessions row defaults owner to 'local' and accepts the documented columns", () => {
  const db = new Database(join(dir, 'test.db'));
  migrate(db, SESSION_MIGRATIONS);
  db.run(
    "INSERT INTO sessions (id, title, created_at, updated_at) VALUES ('s1', 'New chat', 1, 1)",
  );
  const row = db.query('SELECT * FROM sessions WHERE id = ?').get('s1') as
    | {
        id: string;
        title: string;
        owner: string;
        last_message_at: number | null;
        run_id: string | null;
      }
    | undefined;
  expect(row?.owner).toBe('local');
  expect(row?.last_message_at).toBeNull();
  expect(row?.run_id).toBeNull();
  db.close();
});

test('messages.session_id enforces the sessions(id) foreign key when PRAGMA foreign_keys is ON', () => {
  const db = new Database(join(dir, 'test.db'));
  db.run('PRAGMA foreign_keys = ON');
  migrate(db, SESSION_MIGRATIONS);
  expect(() =>
    db.run(
      "INSERT INTO messages (id, session_id, role, parts, created_at) VALUES ('m1', 'missing-session', 'user', '[]', 1)",
    ),
  ).toThrow();
  db.close();
});

test('messages row accepts a NULL parent_message_id and NULL degraded (both reserved/optional)', () => {
  const db = new Database(join(dir, 'test.db'));
  db.run('PRAGMA foreign_keys = ON');
  migrate(db, SESSION_MIGRATIONS);
  db.run(
    "INSERT INTO sessions (id, title, created_at, updated_at) VALUES ('s1', 'New chat', 1, 1)",
  );
  db.run(
    "INSERT INTO messages (id, session_id, role, parts, created_at) VALUES ('m1', 's1', 'user', '[]', 1)",
  );
  const row = db.query('SELECT * FROM messages WHERE id = ?').get('m1') as
    | { parent_message_id: string | null; degraded: number | null }
    | undefined;
  expect(row?.parent_message_id).toBeNull();
  expect(row?.degraded).toBeNull();
  db.close();
});
