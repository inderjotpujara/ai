## Task 3: `MemoryStore.getByIds`

**Files:** Modify `src/memory/lancedb-store.ts` (add `getByIds`), `src/memory/store.ts` (expose it); Test `tests/memory/getbyids.test.ts`

**Interfaces:** Produces `LanceStore.getByIds(space, ids: string[]): Promise<RetrievalResult[]>` and `MemoryStore.getByIds(space, ids)`.

- [ ] **Step 1: Failing test** (real LanceDB, tiny table — mirror `tests/memory/lancedb-smoke.test.ts`)
```ts
// tests/memory/getbyids.test.ts
import { afterEach, describe, expect, test } from 'bun:test';
import { rmSync } from 'node:fs';
import { LanceStore } from '../../src/memory/lancedb-store.ts';
import { MemoryKind } from '../../src/memory/types.ts';

const DIR = '/tmp/getbyids-test';
afterEach(() => { try { rmSync(DIR, { recursive: true, force: true }); } catch {} });

describe('LanceStore.getByIds', () => {
  test('returns only the requested ids', async () => {
    const s = new LanceStore(DIR);
    await s.openOrCreateTable('default', 2);
    await s.upsert('default', [
      { id: 'a#0', space: 'default', namespace: '', kind: MemoryKind.Document, text: 'alpha', vector: [1,0], source: 'a', createdAt: 1 },
      { id: 'b#0', space: 'default', namespace: '', kind: MemoryKind.Document, text: 'beta', vector: [0,1], source: 'b', createdAt: 1 },
    ]);
    const got = await s.getByIds('default', ['a#0']);
    expect(got.map((r) => r.id)).toEqual(['a#0']);
    expect(got[0]?.text).toBe('alpha');
    expect(await s.getByIds('default', [])).toEqual([]);
  }, 60_000);
});
```

- [ ] **Step 2: Run → FAIL** (`getByIds` undefined).
- [ ] **Step 3: Implement `getByIds`** in `src/memory/lancedb-store.ts` (reuse the file's `escapeSqlLiteral` + query pattern used by `hybridSearch`):
```ts
async getByIds(space: string, ids: string[]): Promise<RetrievalResult[]> {
  if (ids.length === 0) return [];
  const db = await this.db();
  const tbl = await db.openTable(space);
  const list = ids.map((i) => `'${escapeSqlLiteral(i)}'`).join(',');
  const rows = (await tbl.query().where(`id IN (${list})`).toArray()) as any[];
  return rows.map((r) => ({ id: r.id, text: r.text, source: r.source, score: 0, namespace: r.namespace }));
}
```
> Confirm the non-vector query API in the installed `@lancedb/lancedb@0.30.0` (`tbl.query().where(...).toArray()`); if the accessor differs, use the version's real filter-query API. Keep the signature stable. Type the row shape if biome flags `any`.

- [ ] **Step 4: Expose on the facade** in `src/memory/store.ts` — add to the returned object: `async getByIds(space: string, ids: string[]) { return lance.getByIds(space, ids); }`

- [ ] **Step 5: Run tests + typecheck + full suite** → PASS.
- [ ] **Step 6: Commit** — `git commit -m "feat(memory): getByIds(space, ids) for citation-evidence lookup"`

---

