## Task 8: Retrieval pipeline (hybrid → RRF → budget-fit; rerank seam)

**Files:**
- Create: `src/memory/retrieve.ts`
- Test: `tests/memory/retrieve.test.ts`

**Interfaces:**
- Produces: `type RetrieveDeps = { lance: Pick<LanceStore,'hybridSearch'>; embedQuery: (t: string) => Promise<number[]>; space: SpaceMeta; reranker?: Reranker }`; `retrieve(query: string, opts: RecallOptions, deps: RetrieveDeps): Promise<RetrievalResult[]>`. `type Reranker = { rerank(query: string, results: RetrievalResult[]): Promise<RetrievalResult[]> }`.
- Consumes: `retrievalBudgetChars` (Task 2); `withMemoryRecallSpan` (Task 3); `currentDelegationContext` (guardrails); `MemoryError`.

- [ ] **Step 1: Write the failing test**
```ts
// tests/memory/retrieve.test.ts
import { describe, expect, test } from 'vitest';
import { retrieve } from '../../src/memory/retrieve.ts';
import { MemoryError } from '../../src/core/errors.ts';
import { MemoryKind, type RetrievalResult, type SpaceMeta } from '../../src/memory/types.ts';

const space: SpaceMeta = { name: 'default', embedModel: 'e', embedDim: 2, chunkCapTokens: 100, createdAt: 1 };
const cand = (id: string, text: string, score: number): RetrievalResult => ({ id, text, source: 's', score, namespace: '' });

describe('retrieve', () => {
  test('budget-fit returns fewer than topK when ctx is tight', async () => {
    const deps = {
      space,
      embedQuery: async () => [1, 0],
      lance: { hybridSearch: async () => [cand('a', 'x'.repeat(400), 0.1), cand('b', 'y'.repeat(400), 0.2)] },
    };
    const out = await retrieve('q', { topK: 5, numCtx: 256 }, deps); // budget 0.25*256*4=256 chars
    expect(out.length).toBe(1);
    expect(out[0].id).toBe('a');
  });
  test('dimension mismatch throws MemoryError', async () => {
    const deps = { space, embedQuery: async () => [1, 0, 0], lance: { hybridSearch: async () => [] } };
    await expect(retrieve('q', {}, deps)).rejects.toBeInstanceOf(MemoryError);
  });
  test('applies reranker when provided', async () => {
    const deps = {
      space,
      embedQuery: async () => [1, 0],
      lance: { hybridSearch: async () => [cand('a', 'aa', 0.9), cand('b', 'bb', 0.1)] },
      reranker: { rerank: async (_q: string, r: RetrievalResult[]) => [...r].reverse() },
    };
    const out = await retrieve('q', { topK: 2, numCtx: 8192, rerank: true }, deps);
    expect(out[0].id).toBe('b');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `bun test tests/memory/retrieve.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write `src/memory/retrieve.ts`**
```ts
import { MemoryError } from '../core/errors.ts';
import { currentDelegationContext } from '../core/guardrails.ts';
import { withMemoryRecallSpan } from '../telemetry/spans.ts';
import { retrievalBudgetChars } from './budget.ts';
import type { LanceStore } from './lancedb-store.ts';
import type { RecallOptions, RetrievalResult, SpaceMeta } from './types.ts';

export type Reranker = { rerank(query: string, results: RetrievalResult[]): Promise<RetrievalResult[]> };
export type RetrieveDeps = {
  lance: Pick<LanceStore, 'hybridSearch'>;
  embedQuery: (t: string) => Promise<number[]>;
  space: SpaceMeta;
  reranker?: Reranker;
};

const DEFAULT_TOP_K = () => {
  const raw = Number(process.env.AGENT_MEMORY_TOP_K);
  return Number.isInteger(raw) && raw > 0 ? raw : 6;
};

export async function retrieve(query: string, opts: RecallOptions, deps: RetrieveDeps): Promise<RetrievalResult[]> {
  const topK = opts.topK ?? DEFAULT_TOP_K();
  const numCtx = opts.numCtx ?? currentDelegationContext().numCtx;
  return withMemoryRecallSpan(
    { space: deps.space.name, namespace: opts.namespace, reranked: !!(opts.rerank && deps.reranker) },
    async () => {
      const vector = await deps.embedQuery(query);
      if (vector.length !== deps.space.embedDim) {
        throw new MemoryError(`query embedding dim ${vector.length} ≠ space '${deps.space.name}' dim ${deps.space.embedDim}`);
      }
      let candidates = await deps.lance.hybridSearch(deps.space.name, {
        queryVector: vector, queryText: query, namespace: opts.namespace, kind: opts.kind, limit: topK * 4,
      });
      if (opts.rerank && deps.reranker) candidates = await deps.reranker.rerank(query, candidates);
      // budget-fit: pack top-ranked results until the live char budget is spent, capped at topK.
      const budget = retrievalBudgetChars(numCtx);
      const out: RetrievalResult[] = [];
      let used = 0;
      for (const c of candidates) {
        if (out.length >= topK) break;
        if (used + c.text.length > budget && out.length > 0) break;
        out.push(c); used += c.text.length;
      }
      return out;
    },
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**
Run: `bun test tests/memory/retrieve.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add src/memory/retrieve.ts tests/memory/retrieve.test.ts
git commit -m "feat(memory): retrieval pipeline (RRF candidates → budget-fit → top-k, rerank seam)"
```

---

