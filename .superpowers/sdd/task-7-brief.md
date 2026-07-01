## Task 7: LanceDB vector store adapter (+ native smoke test)

**Files:**
- Modify: `package.json` (add `@lancedb/lancedb@0.30.0`)
- Create: `src/memory/lancedb-store.ts`
- Test: `tests/memory/lancedb-smoke.test.ts`

**Interfaces:**
- Produces: `class LanceStore` with `openOrCreateTable(space: string, dim: number): Promise<void>`, `upsert(space: string, records: MemoryRecord[]): Promise<void>`, `hybridSearch(space: string, q: { queryVector: number[]; queryText: string; namespace?: string; kind?: MemoryKind; limit: number }): Promise<RetrievalResult[]>`, `count(space: string): Promise<number>`, `dropTable(space: string): Promise<void>`. Constructor `new LanceStore(dir: string)`.
- Consumes: `MemoryRecord`, `RetrievalResult`, `MemoryKind` from `types.ts`; `@lancedb/lancedb`.

- [ ] **Step 1: Add the dependency (kept external)**
Run: `bun add @lancedb/lancedb@0.30.0`
Then verify it is NOT added to any bundle/externalization list incorrectly (search for a build/bundle config; if one exists, mark `@lancedb/lancedb` external).

- [ ] **Step 2: Write the failing smoke test**
```ts
// tests/memory/lancedb-smoke.test.ts
import { afterEach, describe, expect, test } from 'vitest';
import { rmSync } from 'node:fs';
import { LanceStore } from '../../src/memory/lancedb-store.ts';
import { MemoryKind } from '../../src/memory/types.ts';

const DIR = '/tmp/lance-smoke';
afterEach(() => { try { rmSync(DIR, { recursive: true, force: true }); } catch {} });

describe('LanceStore (native load + roundtrip)', () => {
  test('create, upsert, dense search returns nearest', async () => {
    const s = new LanceStore(DIR);
    await s.openOrCreateTable('default', 2);
    await s.upsert('default', [
      { id: 'a', space: 'default', namespace: '', kind: MemoryKind.Document, text: 'apple', vector: [1, 0], source: 'x', createdAt: 1 },
      { id: 'b', space: 'default', namespace: '', kind: MemoryKind.Document, text: 'banana', vector: [0, 1], source: 'x', createdAt: 1 },
    ]);
    expect(await s.count('default')).toBe(2);
    const hits = await s.hybridSearch('default', { queryVector: [0.9, 0.1], queryText: 'apple', namespace: '', limit: 1 });
    expect(hits[0].id).toBe('a');
  }, 60_000);
});
```

- [ ] **Step 3: Run test to verify it fails**
Run: `bun test tests/memory/lancedb-smoke.test.ts`
Expected: FAIL (module not found / adapter absent). If it fails with a NATIVE LOAD error, stop and record it — that is the go/no-go signal for LanceDB under Bun and must be reported before proceeding.

- [ ] **Step 4: Write `src/memory/lancedb-store.ts`**
```ts
import * as lancedb from '@lancedb/lancedb';
import type { MemoryKind, MemoryRecord, RetrievalResult } from './types.ts';

export class LanceStore {
  private conn?: Awaited<ReturnType<typeof lancedb.connect>>;
  constructor(private dir: string) {}
  private async db() { this.conn ??= await lancedb.connect(this.dir); return this.conn; }

  async openOrCreateTable(space: string, dim: number): Promise<void> {
    const db = await this.db();
    const names = await db.tableNames();
    if (names.includes(space)) return;
    // sample row establishes schema (vector width = dim); removed immediately.
    const sample = [{ id: '__seed__', space, namespace: '', kind: 'document', text: '', vector: Array(dim).fill(0), source: '', createdAt: 0 }];
    const tbl = await db.createTable(space, sample);
    await tbl.delete("id = '__seed__'");
    try { await tbl.createIndex('text', { config: lancedb.Index.fts() }); } catch { /* FTS optional if unsupported */ }
  }

  async upsert(space: string, records: MemoryRecord[]): Promise<void> {
    if (records.length === 0) return;
    const db = await this.db();
    const tbl = await db.openTable(space);
    const ids = records.map((r) => `'${r.id.replace(/'/g, "''")}'`).join(',');
    await tbl.delete(`id IN (${ids})`);
    await tbl.add(records.map((r) => ({ ...r, kind: String(r.kind) })));
  }

  async hybridSearch(space: string, q: { queryVector: number[]; queryText: string; namespace?: string; kind?: MemoryKind; limit: number }): Promise<RetrievalResult[]> {
    const db = await this.db();
    const tbl = await db.openTable(space);
    const filters: string[] = [];
    if (q.namespace != null && q.namespace !== '') filters.push(`namespace = '${q.namespace.replace(/'/g, "''")}'`);
    if (q.kind) filters.push(`kind = '${String(q.kind)}'`);
    const where = filters.join(' AND ');
    let query = tbl.search(q.queryVector).limit(q.limit);
    if (where) query = query.where(where);
    const rows = (await query.toArray()) as any[];
    return rows.map((r) => ({ id: r.id, text: r.text, source: r.source, score: r._distance ?? 0, namespace: r.namespace }));
  }

  async count(space: string): Promise<number> {
    const db = await this.db();
    const tbl = await db.openTable(space);
    return tbl.countRows();
  }
  async dropTable(space: string): Promise<void> {
    const db = await this.db();
    await db.dropTable(space);
  }
}
```
> The `@lancedb/lancedb@0.30.0` JS API for FTS index creation + hybrid `.search(text, queryType)` may differ from the above sketch. Consult the installed package's types/docs (`node_modules/@lancedb/lancedb`) and the LanceDB hybrid-search docs; make dense search + namespace/kind filter WORK first (the smoke test only needs dense). Add true BM25/FTS + RRF hybrid once dense passes — if FTS index creation isn't available in this version, fall back to dense-only and note it (Task 8 retrieve still works; hybrid becomes a follow-up). Keep the public method signatures above stable regardless.

- [ ] **Step 5: Run smoke test to verify it passes**
Run: `bun test tests/memory/lancedb-smoke.test.ts`
Expected: PASS (native `.node` loads; roundtrip works).

- [ ] **Step 6: Commit**
```bash
git add package.json bun.lock src/memory/lancedb-store.ts tests/memory/lancedb-smoke.test.ts
git commit -m "feat(memory): LanceDB vector store adapter + native-load smoke test"
```

---

