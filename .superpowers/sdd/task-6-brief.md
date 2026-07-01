## Task 6: sqlite structured store (space registry + doc manifest)

**Files:**
- Create: `src/memory/sqlite-store.ts`
- Test: `tests/memory/sqlite-store.test.ts`

**Interfaces:**
- Produces: `class SqliteStore` with `getSpace(name): SpaceMeta | undefined`, `createSpace(meta: SpaceMeta): void`, `listSpaces(): SpaceMeta[]`, `seenDoc(source: string, hash: string): boolean`, `recordDoc(source: string, hash: string, chunks: number, at: number): void`, `close(): void`. Constructor `new SqliteStore(dbPath: string)`.
- Consumes: `SpaceMeta` from `types.ts`; `bun:sqlite`.

- [ ] **Step 1: Write the failing test**
```ts
// tests/memory/sqlite-store.test.ts
import { afterEach, describe, expect, test } from 'vitest';
import { rmSync } from 'node:fs';
import { SqliteStore } from '../../src/memory/sqlite-store.ts';

const DB = '/tmp/mem-test.db';
afterEach(() => { try { rmSync(DB); } catch {} });

describe('SqliteStore', () => {
  test('space create/get is authoritative for embedder', () => {
    const s = new SqliteStore(DB);
    expect(s.getSpace('default')).toBeUndefined();
    s.createSpace({ name: 'default', embedModel: 'qwen3-embedding:0.6b', embedDim: 768, chunkCapTokens: 512, createdAt: 1 });
    expect(s.getSpace('default')?.embedModel).toBe('qwen3-embedding:0.6b');
    expect(s.getSpace('default')?.embedDim).toBe(768);
    s.close();
  });
  test('doc dedupe by hash', () => {
    const s = new SqliteStore(DB);
    expect(s.seenDoc('a.md', 'h1')).toBe(false);
    s.recordDoc('a.md', 'h1', 3, 1);
    expect(s.seenDoc('a.md', 'h1')).toBe(true);
    expect(s.seenDoc('a.md', 'h2')).toBe(false); // changed content
    s.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `bun test tests/memory/sqlite-store.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write `src/memory/sqlite-store.ts`**
```ts
import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { SpaceMeta } from './types.ts';

export class SqliteStore {
  private db: Database;
  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.run(`CREATE TABLE IF NOT EXISTS spaces (
      name TEXT PRIMARY KEY, embed_model TEXT NOT NULL, embed_dim INTEGER NOT NULL,
      chunk_cap_tokens INTEGER NOT NULL, created_at INTEGER NOT NULL)`);
    this.db.run(`CREATE TABLE IF NOT EXISTS documents (
      source TEXT PRIMARY KEY, hash TEXT NOT NULL, chunks INTEGER NOT NULL, at INTEGER NOT NULL)`);
  }
  getSpace(name: string): SpaceMeta | undefined {
    const r = this.db.query('SELECT * FROM spaces WHERE name = ?').get(name) as any;
    if (!r) return undefined;
    return { name: r.name, embedModel: r.embed_model, embedDim: r.embed_dim, chunkCapTokens: r.chunk_cap_tokens, createdAt: r.created_at };
  }
  createSpace(m: SpaceMeta): void {
    this.db.run('INSERT OR REPLACE INTO spaces VALUES (?,?,?,?,?)', [m.name, m.embedModel, m.embedDim, m.chunkCapTokens, m.createdAt]);
  }
  listSpaces(): SpaceMeta[] {
    const rows = this.db.query('SELECT * FROM spaces').all() as any[];
    return rows.map((r) => ({ name: r.name, embedModel: r.embed_model, embedDim: r.embed_dim, chunkCapTokens: r.chunk_cap_tokens, createdAt: r.created_at }));
  }
  seenDoc(source: string, hash: string): boolean {
    const r = this.db.query('SELECT hash FROM documents WHERE source = ?').get(source) as any;
    return !!r && r.hash === hash;
  }
  recordDoc(source: string, hash: string, chunks: number, at: number): void {
    this.db.run('INSERT OR REPLACE INTO documents VALUES (?,?,?,?)', [source, hash, chunks, at]);
  }
  close(): void { this.db.close(); }
}
```

- [ ] **Step 4: Run tests to verify they pass**
Run: `bun test tests/memory/sqlite-store.test.ts && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add src/memory/sqlite-store.ts tests/memory/sqlite-store.test.ts
git commit -m "feat(memory): bun:sqlite space registry + doc manifest"
```

---

