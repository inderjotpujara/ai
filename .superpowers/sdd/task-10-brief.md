### Task 10: `eval_history` store + `EVAL_HISTORY_MIGRATIONS` (superset extension, R3)

**Files:**
- Create: `src/self-improve/history.ts`
- Modify: `src/triggers/migrations.ts:85` (extend `JOBS_DB_MIGRATIONS`)
- Test: `tests/self-improve/history.test.ts`, extend `tests/triggers/migrations.test.ts`

**Interfaces:**
- Consumes: `Database` from `bun:sqlite`; `migrate` from `../db/migrate.ts`; `Migration` type; `JOBS_DB_MIGRATIONS` from `../triggers/migrations.ts`; `EvalCaseResult` from `../verified-build/types.ts`.
- Produces:
  ```ts
  export type EvalHistoryRow = {
    id: string; artifactId: string; model: string; baselineModel?: string;
    ts: number; passed: boolean; passedCount: number; total: number;
    regressed: boolean; perCase: EvalCaseResult[]; judgeModel: string; belowBar: boolean; reason?: string;
  };
  export type EvalHistoryStore = {
    insert(row: EvalHistoryRow): void;                 // append-only — NO update/delete method exists
    listByArtifact(artifactId: string): EvalHistoryRow[]; // ts DESC
    latestPassing(artifactId: string): EvalHistoryRow | undefined;
    close(): void;
  };
  export function createEvalHistoryStore(config: { path?: string }): EvalHistoryStore;
  ```
  **R3 — CRITICAL:** `EVAL_HISTORY_MIGRATIONS` is appended to the `jobs.db` superset in `src/triggers/migrations.ts`: `export const JOBS_DB_MIGRATIONS: Migration[] = [...JOB_MIGRATIONS, ...TRIGGER_MIGRATIONS, ...EVAL_HISTORY_MIGRATIONS];`. `createEvalHistoryStore` opens `<AGENT_QUEUE_PATH>/jobs.db` and runs `migrate(db, JOBS_DB_MIGRATIONS)` — the FULL superset, NEVER an independent list (a per-DB single `PRAGMA user_version` means two lists over one file collide silently). Pragma trio: `PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;` (mirror `createSessionStore`, `src/session/store.ts:117-121`).

- [ ] **Step 1: Write the failing tests**

```ts
import { expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEvalHistoryStore } from '../../src/self-improve/history.ts';

const dir = () => mkdtempSync(join(tmpdir(), 'eh-'));
const row = (o: Partial<import('../../src/self-improve/history.ts').EvalHistoryRow>) => ({
  id: crypto.randomUUID(), artifactId: 'a', model: 'B:7b', ts: 1, passed: true,
  passedCount: 3, total: 3, regressed: false, perCase: [], judgeModel: 'J:32b', belowBar: false, ...o,
});

test('insert + listByArtifact returns rows newest-first (ts DESC)', () => {
  const s = createEvalHistoryStore({ path: dir() });
  s.insert(row({ ts: 1 })); s.insert(row({ ts: 3 })); s.insert(row({ ts: 2 }));
  expect(s.listByArtifact('a').map((r) => r.ts)).toEqual([3, 2, 1]);
  s.close();
});
test('latestPassing skips regressed/failed rows and returns the newest passing', () => {
  const s = createEvalHistoryStore({ path: dir() });
  s.insert(row({ ts: 1, passed: true }));
  s.insert(row({ ts: 2, passed: false, regressed: true }));
  expect(s.latestPassing('a')?.ts).toBe(1);
  s.close();
});
test('perCase round-trips through the TEXT JSON column', () => {
  const s = createEvalHistoryStore({ path: dir() });
  s.insert(row({ perCase: [{ id: 'c0', passed: false, detail: 'judge answered no' }] }));
  expect(s.listByArtifact('a')[0]?.perCase[0]).toMatchObject({ id: 'c0', passed: false });
  s.close();
});
test('the store has no update/delete surface (append-only, §7.4)', () => {
  const s = createEvalHistoryStore({ path: dir() });
  expect((s as Record<string, unknown>).update).toBeUndefined();
  expect((s as Record<string, unknown>).delete).toBeUndefined();
  s.close();
});
```

```ts
// tests/triggers/migrations.test.ts — ADD: the superset now ends with eval_history,
// and JOB_MIGRATIONS stays the strict prefix.
test('JOBS_DB_MIGRATIONS ends with the eval_history migration (Slice 32)', () => {
  expect(JOBS_DB_MIGRATIONS.at(-1)?.name).toBe('init-eval-history');
});
```

- [ ] **Step 2: Run tests to verify they fail** → FAIL.
- [ ] **Step 3: Write minimal implementation** — define `EVAL_HISTORY_MIGRATIONS` (exported from `history.ts`, imported by `migrations.ts` to append to the superset):

```sql
CREATE TABLE IF NOT EXISTS eval_history (
  id             TEXT PRIMARY KEY,
  artifact_id    TEXT NOT NULL,
  model          TEXT NOT NULL,
  baseline_model TEXT,
  ts             INTEGER NOT NULL,
  passed         INTEGER NOT NULL,
  passed_count   INTEGER NOT NULL,
  total          INTEGER NOT NULL,
  regressed      INTEGER NOT NULL,
  per_case       TEXT NOT NULL,
  judge_model    TEXT NOT NULL,
  below_bar      INTEGER NOT NULL,
  reason         TEXT
);
CREATE INDEX IF NOT EXISTS idx_eval_history_artifact_ts ON eval_history (artifact_id, ts DESC);
```

```ts
// src/self-improve/history.ts — the migration + store; camelCase rows ↔ snake_case columns
export const EVAL_HISTORY_MIGRATIONS: Migration[] = [
  { name: 'init-eval-history', up: (db) => { db.run(`CREATE TABLE …`); db.run(`CREATE INDEX …`); } },
];
export function createEvalHistoryStore(config: { path?: string }): EvalHistoryStore {
  const dbPath = join(config.path ?? 'jobs', 'jobs.db');
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.run('PRAGMA journal_mode = WAL');
  db.run('PRAGMA busy_timeout = 5000');
  db.run('PRAGMA foreign_keys = ON');
  migrate(db, JOBS_DB_MIGRATIONS); // the FULL superset — R3
  // insert / listByArtifact (ORDER BY ts DESC) / latestPassing (WHERE passed=1 AND regressed=0 ORDER BY ts DESC LIMIT 1)
  …
}
```

Import `JOBS_DB_MIGRATIONS` into `history.ts` and `EVAL_HISTORY_MIGRATIONS` into `migrations.ts`. NOTE the circular-import risk: `migrations.ts` importing from `history.ts` (which imports `JOBS_DB_MIGRATIONS` from `migrations.ts`). Break it by defining `EVAL_HISTORY_MIGRATIONS` in a leaf module `src/self-improve/history-migrations.ts` that imports NOTHING from `migrations.ts`; `migrations.ts` imports the leaf; `history.ts` imports `JOBS_DB_MIGRATIONS` from `migrations.ts`. (Verify no cycle with `bun run typecheck`.)

- [ ] **Step 4: Run tests to verify they pass** — `bun run test:file -- "tests/self-improve/history.test.ts" "tests/triggers/migrations.test.ts"` → PASS.
- [ ] **Step 5: Gate + commit** — `bun run typecheck && bun run lint:file -- src/self-improve/history.ts src/self-improve/history-migrations.ts src/triggers/migrations.ts tests/self-improve/history.test.ts tests/triggers/migrations.test.ts`.

```bash
git add src/self-improve/history.ts src/self-improve/history-migrations.ts src/triggers/migrations.ts tests/self-improve/history.test.ts tests/triggers/migrations.test.ts
git commit -m "feat(self-improve): append-only eval_history store in jobs.db (JOBS_DB_MIGRATIONS superset extension)"
```

*Model: Opus (R3 migration-superset is a silent-corruption trap; the circular-import break + append-only invariant need care).*

