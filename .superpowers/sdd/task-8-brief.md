### Task 8: Schema migrations + embedder-mismatch guard

**Files:**
- Create: `src/db/migrate.ts`
- Create: `tests/db/migrate.test.ts`
- Modify: `src/memory/sqlite-store.ts` (run migrations instead of bare `CREATE TABLE IF NOT EXISTS`)
- Modify: `src/memory/store.ts:34` (`ensureSpace` embedder guard)
- Create: `tests/memory/ensure-space-guard.test.ts`

**Interfaces:**
- Consumes: `bun:sqlite` `Database`.
- Produces:
  - `migrate(db: Database, migrations: Migration[]): number` — applies migrations whose index ≥ `PRAGMA user_version`, bumps `user_version`, returns the new version. `type Migration = { name: string; up: (db: Database) => void }`.
  - `ensureSpace` now throws `MemoryError` when a space exists but its stored `embedModel` differs from the configured one (instead of silently returning the stale space).

- [ ] **Step 1: Write the failing tests**

```ts
// tests/db/migrate.test.ts
import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { migrate } from '../../src/db/migrate.ts';

test('migrate applies pending migrations once and is idempotent', () => {
  const db = new Database(':memory:');
  const ms = [
    { name: 'init', up: (d: Database) => d.run('CREATE TABLE t (id INTEGER)') },
    { name: 'add-col', up: (d: Database) => d.run('ALTER TABLE t ADD COLUMN v TEXT') },
  ];
  expect(migrate(db, ms)).toBe(2);
  expect(migrate(db, ms)).toBe(2); // no-op second time
  const cols = db.query('PRAGMA table_info(t)').all() as { name: string }[];
  expect(cols.map((c) => c.name)).toEqual(['id', 'v']);
});
```

```ts
// tests/memory/ensure-space-guard.test.ts
import { afterEach, expect, test } from 'bun:test';
import { rmSync } from 'node:fs';
import { createMemoryStore } from '../../src/memory/store.ts';

const DIR = '/tmp/embguard-test';
afterEach(() => { try { rmSync(DIR, { recursive: true, force: true }); } catch {} });

function deps(dim: number) {
  return { embedTexts: async () => [], embedQuery: async () => [],
    probe: async () => ({ dim, maxInput: 512 }) };
}
test('ensureSpace refuses a configured embedder that differs from the stored one', async () => {
  const a = createMemoryStore({ path: DIR, embedModel: 'model-a' }, deps(8));
  await a.remember('hello', { space: 'default' }); a.close();
  const b = createMemoryStore({ path: DIR, embedModel: 'model-b' }, deps(8));
  await expect(b.remember('again', { space: 'default' })).rejects.toThrow(/embedder/i);
  b.close();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test tests/db/migrate.test.ts tests/memory/ensure-space-guard.test.ts`
Expected: FAIL — `migrate` missing; the guard test currently *passes silently corrupting* (no throw), so it fails the `rejects`.

- [ ] **Step 3: Implement the migration runner**

```ts
// src/db/migrate.ts
import type { Database } from 'bun:sqlite';
export type Migration = { name: string; up: (db: Database) => void };

/** Apply migrations past the DB's user_version, in order, in a transaction each. Returns new version. */
export function migrate(db: Database, migrations: Migration[]): number {
  const row = db.query('PRAGMA user_version').get() as { user_version: number };
  let version = row.user_version;
  for (let i = version; i < migrations.length; i++) {
    const tx = db.transaction(() => { migrations[i].up(db); });
    tx();
    version = i + 1;
    db.run(`PRAGMA user_version = ${version}`);
  }
  return version;
}
```

- [ ] **Step 4: Use migrations in SqliteStore + add the guard**

In `src/memory/sqlite-store.ts`, replace the two `CREATE TABLE IF NOT EXISTS` calls with `migrate(this.db, MEMORY_MIGRATIONS)` where `MEMORY_MIGRATIONS` (module const) wraps the two existing `CREATE TABLE` statements as migration `up`s (v1). Import `migrate`.

In `src/memory/store.ts` `ensureSpace`, change the early return:

```ts
    const existing = sql.getSpace(space);
    if (existing) {
      if (existing.embedModel !== cfg.embedModel) {
        throw new MemoryError(
          `space '${space}' was built with embedder '${existing.embedModel}' but '${cfg.embedModel}' is configured — run 'memory reindex ${space} ${cfg.embedModel}' (destructive) or restore the original embedder.`,
        );
      }
      return existing;
    }
```

- [ ] **Step 5: Run tests + typecheck**

Run: `bun test tests/db/ tests/memory/ && bun run typecheck`
Expected: PASS (existing memory tests unaffected — v1 migration reproduces the same schema).

- [ ] **Step 6: Commit**

```bash
git add src/db/migrate.ts tests/db/migrate.test.ts src/memory/sqlite-store.ts src/memory/store.ts tests/memory/ensure-space-guard.test.ts
git commit -m "feat(db): user_version migration runner + memory embedder-mismatch guard (was silent corruption)"
```

---

