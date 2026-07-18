## Task 4: `src/session/migrations.ts` — `SESSION_MIGRATIONS`

**Files:**
- Create: `src/session/migrations.ts`
- Test: `tests/session/migrations.test.ts` (create)

**Interfaces:**
- Consumes: `Migration`/`migrate` (`src/db/migrate.ts`, unchanged — `Migration = { name: string; up: (db: Database) => void }`).
- Produces: `SESSION_MIGRATIONS: Migration[]` — one migration, `'init-sessions-and-messages'`, creating `sessions(id PK, title, owner NOT NULL DEFAULT 'local', created_at, updated_at, last_message_at NULL, run_id NULL)` and `messages(id PK, session_id NOT NULL REFERENCES sessions(id), parent_message_id NULL, role, parts TEXT NOT NULL, created_at, degraded NULL)`, plus a supporting index `idx_messages_session (session_id, created_at)` (needed by Task 7's `getMessages` ORDER BY).

- [ ] **Step 1: Write the failing tests**

`tests/session/migrations.test.ts`:
```typescript
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

test('sessions row defaults owner to \'local\' and accepts the documented columns', () => {
  const db = new Database(join(dir, 'test.db'));
  migrate(db, SESSION_MIGRATIONS);
  db.run(
    "INSERT INTO sessions (id, title, created_at, updated_at) VALUES ('s1', 'New chat', 1, 1)",
  );
  const row = db.query('SELECT * FROM sessions WHERE id = ?').get('s1') as
    | { id: string; title: string; owner: string; last_message_at: number | null; run_id: string | null }
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test tests/session/migrations.test.ts`
Expected: FAIL — `src/session/migrations.ts` does not exist yet (module resolution error).

- [ ] **Step 3: Create `src/session/migrations.ts`**

```typescript
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test tests/session/migrations.test.ts`
Expected: PASS (all 5 tests).

- [ ] **Step 5: Gate + commit**

```bash
bun run typecheck && bun run lint:file -- src/session/migrations.ts tests/session/migrations.test.ts
git add src/session/migrations.ts tests/session/migrations.test.ts
git commit -m "feat(session): add SESSION_MIGRATIONS (sessions + messages tables) (Phase 6 Incr 1)"
```

---

