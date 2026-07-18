## Task 5: `src/session/store.ts` — factory scaffold + `upsertSession`/`getSession`/`close`

**Files:**
- Create: `src/session/store.ts`
- Test: `tests/session/store.test.ts` (create)

**Interfaces:**
- Consumes: `migrate` (`src/db/migrate.ts`), `SESSION_MIGRATIONS` (Task 4, `src/session/migrations.ts`).
- Produces (this task's slice of the final surface — Tasks 6-8 add the rest to the SAME file/return object):
  - `export type SessionRow = { id: string; title: string; owner: string; createdAt: number; updatedAt: number; lastMessageAt: number | undefined; runId: string | undefined }`
  - `export type SessionStoreDeps = Record<string, never>`
  - `export function createSessionStore(config: { path?: string }, deps: SessionStoreDeps)` — opens `<config.path ?? 'sessions'>/sessions.db` with the WAL/busy_timeout/foreign_keys pragma trio + `migrate(db, SESSION_MIGRATIONS)`.
  - Returned closure (this task): `upsertSession(id: string, opts: { defaultTitle: string; at: number }): void`, `getSession(id: string): SessionRow | undefined`, `close(): void`.

**Design note:** `upsertSession` uses `INSERT OR IGNORE` — a repeat call for the same `id` is a genuine no-op (never a constraint-violation throw, spec §7.1(c)) and, critically, never overwrites an already-stored title (spec D2/D4 "title never overwritten by later upsert").

- [ ] **Step 1: Write the failing tests**

`tests/session/store.test.ts`:
```typescript
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSessionStore, type SessionStore } from '../../src/session/store.ts';

let dir: string;
let store: SessionStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'session-store-'));
  store = createSessionStore({ path: dir }, {});
});
afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('upsertSession / getSession', () => {
  test('upsertSession creates a session on first call', () => {
    store.upsertSession('s1', { defaultTitle: 'New chat', at: 1_000 });
    const row = store.getSession('s1');
    expect(row).toBeDefined();
    expect(row?.id).toBe('s1');
    expect(row?.title).toBe('New chat');
    expect(row?.owner).toBe('local');
    expect(row?.createdAt).toBe(1_000);
    expect(row?.updatedAt).toBe(1_000);
    expect(row?.lastMessageAt).toBeUndefined();
    expect(row?.runId).toBeUndefined();
  });

  test('getSession returns undefined for an absent id', () => {
    expect(store.getSession('nope')).toBeUndefined();
  });

  test('upsertSession is idempotent create-if-absent — a repeat call never overwrites the title', () => {
    store.upsertSession('s1', { defaultTitle: 'First title', at: 1_000 });
    store.upsertSession('s1', { defaultTitle: 'Second title', at: 2_000 });
    const row = store.getSession('s1');
    expect(row?.title).toBe('First title');
    expect(row?.createdAt).toBe(1_000);
    expect(row?.updatedAt).toBe(1_000); // untouched — the second upsert was fully ignored
  });

  test('upsertSession never throws on a repeat id (INSERT OR IGNORE, not a constraint violation)', () => {
    store.upsertSession('s1', { defaultTitle: 'A', at: 1 });
    expect(() =>
      store.upsertSession('s1', { defaultTitle: 'B', at: 2 }),
    ).not.toThrow();
  });

  test('two distinct sessions coexist independently', () => {
    store.upsertSession('s1', { defaultTitle: 'One', at: 1 });
    store.upsertSession('s2', { defaultTitle: 'Two', at: 2 });
    expect(store.getSession('s1')?.title).toBe('One');
    expect(store.getSession('s2')?.title).toBe('Two');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test tests/session/store.test.ts`
Expected: FAIL — `src/session/store.ts` does not exist yet.

- [ ] **Step 3: Create `src/session/store.ts`**

```typescript
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

  return {
    upsertSession,
    getSession,
    close: (): void => db.close(),
  };
}

export type SessionStore = ReturnType<typeof createSessionStore>;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test tests/session/store.test.ts`
Expected: PASS (all 5 tests).

- [ ] **Step 5: Gate + commit**

```bash
bun run typecheck && bun run lint:file -- src/session/store.ts tests/session/store.test.ts
git add src/session/store.ts tests/session/store.test.ts
git commit -m "feat(session): add createSessionStore scaffold with upsertSession/getSession (Phase 6 Incr 1)"
```

---

