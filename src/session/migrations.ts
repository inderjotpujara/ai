import type { Database } from 'bun:sqlite';
import type { Migration } from '../db/migrate.ts';

/**
 * One migration for the whole `sessions.db`: `sessions` (one row per chat
 * conversation) and `messages` (one row per persisted turn-half). Mirrors
 * `src/memory/sqlite-store.ts`'s `MEMORY_MIGRATIONS` shape/idiom, but lives in
 * its own file (`src/session/migrations.ts`) per spec §4.3, since `store.ts`
 * is already the bigger of the two files here.
 *
 * `parent_message_id` is nullable and written but NOT consumed for threading
 * this phase (spec D12 — reserved for Slice 41's edit-in-place history).
 * `degraded` is nullable — set only for an assistant turn that saw a
 * `StatusEventType.Degrade` event (spec D7); a user message row always has it
 * NULL. `run_id` on `sessions` is nullable — reserved for a future increment
 * to populate (see the Increment 1 report's note on `appendMessage`).
 */
export const SESSION_MIGRATIONS: Migration[] = [
  {
    name: 'init-sessions-and-messages',
    up: (db: Database) => {
      db.run(`CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        owner TEXT NOT NULL DEFAULT 'local',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_message_at INTEGER,
        run_id TEXT
      )`);
      db.run(`CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id),
        parent_message_id TEXT,
        role TEXT NOT NULL,
        parts TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        degraded INTEGER
      )`);
      db.run(
        'CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, created_at)',
      );
    },
  },
];
