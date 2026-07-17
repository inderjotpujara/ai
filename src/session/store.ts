import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { migrate } from '../db/migrate.ts';
import { SESSION_MIGRATIONS } from './migrations.ts';

/** A session row, camelCase on the TS side (columns stay snake_case in SQL —
 *  see `toSessionRow`). Field names match `SessionListItemDTO` 1:1 so a later
 *  server-side projection is a straight passthrough. */
export type SessionRow = {
  id: string;
  title: string;
  owner: string;
  createdAt: number;
  updatedAt: number;
  lastMessageAt: number | undefined;
  runId: string | undefined;
};

type SessionRowRaw = {
  id: string;
  title: string;
  owner: string;
  created_at: number;
  updated_at: number;
  last_message_at: number | null;
  run_id: string | null;
};

function toSessionRow(r: SessionRowRaw): SessionRow {
  return {
    id: r.id,
    title: r.title,
    owner: r.owner,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    lastMessageAt: r.last_message_at ?? undefined,
    runId: r.run_id ?? undefined,
  };
}

/** Reserved second constructor arg — kept only for signature parity with
 *  `createMemoryStore(config, deps)` (`src/memory/store.ts:29`) and as a
 *  future test seam (e.g. a clock override). Empty today (spec D1). */
export type SessionStoreDeps = Record<string, never>;

/**
 * `createSessionStore` mirrors `createMemoryStore`'s factory-returns-closure
 * shape and reuses two existing primitives verbatim: the WAL/busy_timeout/
 * foreign_keys pragma trio (`SqliteStore`'s constructor,
 * `src/memory/sqlite-store.ts:38-41`) and the `migrate(db, migrations)`
 * runner (`src/db/migrate.ts`). Spec D1.
 */
export function createSessionStore(
  config: { path?: string },
  _deps: SessionStoreDeps,
) {
  const dbPath = join(config.path ?? 'sessions', 'sessions.db');
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.run('PRAGMA journal_mode = WAL');
  db.run('PRAGMA busy_timeout = 5000');
  db.run('PRAGMA foreign_keys = ON');
  migrate(db, SESSION_MIGRATIONS);

  function upsertSession(
    id: string,
    opts: { defaultTitle: string; at: number },
  ): void {
    // Create-if-absent, idempotent: a repeat id is a safe no-op — never a
    // constraint-violation throw (spec §7.1(c)) — and never overwrites an
    // already-stored title (spec D2/D4).
    db.run(
      `INSERT OR IGNORE INTO sessions
       (id, title, owner, created_at, updated_at, last_message_at, run_id)
       VALUES (?, ?, 'local', ?, ?, NULL, NULL)`,
      [id, opts.defaultTitle, opts.at, opts.at],
    );
  }

  function getSession(id: string): SessionRow | undefined {
    const r = db.query('SELECT * FROM sessions WHERE id = ?').get(id) as
      | SessionRowRaw
      | undefined;
    return r ? toSessionRow(r) : undefined;
  }

  function renameSession(id: string, title: string, at: number): void {
    db.run('UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?', [
      title,
      at,
      id,
    ]);
  }

  function deleteSession(id: string): void {
    // Transaction: delete messages THEN the session row (spec §4.3) — a
    // crash mid-delete never leaves orphaned messages with no parent.
    const tx = db.transaction(() => {
      db.run('DELETE FROM messages WHERE session_id = ?', [id]);
      db.run('DELETE FROM sessions WHERE id = ?', [id]);
    });
    tx();
  }

  return {
    upsertSession,
    getSession,
    renameSession,
    deleteSession,
    close: (): void => db.close(),
  };
}

export type SessionStore = ReturnType<typeof createSessionStore>;
