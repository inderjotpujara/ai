import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { SessionListItemDTO } from '../contracts/index.ts';
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

/** A stored chat message, RAW (`parts` un-decoded to whatever JSON the
 *  caller passed) — distinct from the wire `ChatMessageDTO` (which flattens
 *  to a `text` string); that projection is the server layer's job, not
 *  this store's. */
export type StoredMessage = {
  id: string;
  sessionId: string;
  parentMessageId: string | undefined;
  role: string;
  parts: unknown;
  createdAt: number;
  degraded: boolean | undefined;
};

type MessageRowRaw = {
  id: string;
  session_id: string;
  parent_message_id: string | null;
  role: string;
  parts: string;
  created_at: number;
  degraded: number | null;
};

function toStoredMessage(r: MessageRowRaw): StoredMessage {
  return {
    id: r.id,
    sessionId: r.session_id,
    parentMessageId: r.parent_message_id ?? undefined,
    role: r.role,
    parts: JSON.parse(r.parts) as unknown,
    createdAt: r.created_at,
    degraded: r.degraded === null ? undefined : r.degraded === 1,
  };
}

function encodeSessionCursor(sortKey: number, id: string): string {
  return Buffer.from(`${sortKey}:${id}`).toString('base64url');
}

function decodeSessionCursor(
  cursor: string,
): { sortKey: number; id: string } | undefined {
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    const idx = decoded.indexOf(':');
    if (idx === -1) return undefined;
    const sortKey = Number(decoded.slice(0, idx));
    const id = decoded.slice(idx + 1);
    if (!Number.isFinite(sortKey) || id.length === 0) return undefined;
    return { sortKey, id };
  } catch {
    return undefined;
  }
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

  function appendMessage(
    sessionId: string,
    msg: {
      id: string;
      role: string;
      parts: unknown;
      parentMessageId?: string;
      degraded?: boolean;
    },
    at: number,
  ): void {
    // INSERT OR IGNORE on the message id: a retried/duplicate POST for the
    // SAME message id is a safe no-op (spec D4/D6/§7.1(d)).
    db.run(
      `INSERT OR IGNORE INTO messages
       (id, session_id, parent_message_id, role, parts, created_at, degraded)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        msg.id,
        sessionId,
        msg.parentMessageId ?? null,
        msg.role,
        JSON.stringify(msg.parts),
        at,
        msg.degraded === undefined ? null : msg.degraded ? 1 : 0,
      ],
    );
    // Touch activity timestamps so listSessions's sort key advances.
    // run_id is deliberately NOT touched here — this signature carries no
    // runId; see this task's design note.
    db.run(
      'UPDATE sessions SET updated_at = ?, last_message_at = ? WHERE id = ?',
      [at, at, sessionId],
    );
  }

  function getMessages(sessionId: string): StoredMessage[] {
    const rows = db
      .query(
        'SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC',
      )
      .all(sessionId) as MessageRowRaw[];
    return rows.map(toStoredMessage);
  }

  function listSessions(q: {
    search?: string;
    cursor?: string;
    limit: number;
  }): { items: SessionListItemDTO[]; nextCursor?: string; total: number } {
    const searchClause = q.search ? 'AND lower(title) LIKE ?' : '';
    const searchArgs: (string | number)[] = q.search
      ? [`%${q.search.toLowerCase()}%`]
      : [];

    const totalRow = db
      .query(`SELECT COUNT(*) as n FROM sessions WHERE 1 = 1 ${searchClause}`)
      .get(...searchArgs) as { n: number };

    // A malformed cursor is treated as absent (page 1), never thrown — the
    // list endpoint must degrade gracefully on a tampered/garbage cursor
    // value, matching runs/list.ts's decodeCursorId precedent.
    const cursor = q.cursor ? decodeSessionCursor(q.cursor) : undefined;
    const cursorClause = cursor
      ? `AND (COALESCE(last_message_at, created_at) < ?
          OR (COALESCE(last_message_at, created_at) = ? AND id > ?))`
      : '';
    const cursorArgs: (string | number)[] = cursor
      ? [cursor.sortKey, cursor.sortKey, cursor.id]
      : [];

    // Fetch one extra row to detect "more remain" without a second query.
    const rows = db
      .query(
        `SELECT * FROM sessions WHERE 1 = 1 ${searchClause} ${cursorClause}
         ORDER BY COALESCE(last_message_at, created_at) DESC, id ASC
         LIMIT ?`,
      )
      .all(...searchArgs, ...cursorArgs, q.limit + 1) as SessionRowRaw[];

    const hasMore = rows.length > q.limit;
    const page = rows.slice(0, q.limit);
    const items: SessionListItemDTO[] = page.map((r) => {
      const row = toSessionRow(r);
      return {
        id: row.id,
        title: row.title,
        owner: row.owner,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        lastMessageAt: row.lastMessageAt,
        runId: row.runId,
      };
    });

    const lastRaw = page[page.length - 1];
    const nextCursor =
      hasMore && lastRaw
        ? encodeSessionCursor(
            lastRaw.last_message_at ?? lastRaw.created_at,
            lastRaw.id,
          )
        : undefined;

    return { items, nextCursor, total: totalRow.n };
  }

  return {
    upsertSession,
    getSession,
    renameSession,
    deleteSession,
    listSessions,
    appendMessage,
    getMessages,
    close: (): void => db.close(),
  };
}

export type SessionStore = ReturnType<typeof createSessionStore>;
