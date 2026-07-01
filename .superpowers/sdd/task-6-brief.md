## Task 6: CRAG grader + bounded corrective retrieve

**Files:** Create `src/verification/crag.ts`; Test `tests/verification/crag.test.ts`

**Interfaces:**
- Consumes: `VerifyDeps`, `CragGrade`; `RetrievalResult` + a `recall` fn (injected).
- Produces: `gradeRetrieval(query, chunks, deps): Promise<CragGrade>`; `rewriteQuery(query, deps): Promise<string>`; `correctiveRetrieve(query, recall, deps): Promise<{ query: string; chunks: RetrievalResult[] }>`.

- [ ] **Step 1: Failing test** (mock generate)
```ts
// tests/verification/crag.test.ts
import { describe, expect, test } from 'bun:test';
import { gradeRetrieval, correctiveRetrieve } from '../../src/verification/crag.ts';
import { CragGrade } from '../../src/verification/types.ts';

describe('crag', () => {
  test('gradeRetrieval maps model label → enum', async () => {
    const deps: any = { generate: async () => 'INCORRECT' };
    expect(await gradeRetrieval('q', [], deps)).toBe(CragGrade.Incorrect);
  });
  test('correctiveRetrieve rewrites query + re-recalls once', async () => {
    const deps: any = { generalModel: 'g', generate: async () => 'better query' };
    const recall = async (q: string) => [{ id: 'x#0', text: 'hit for '+q, source: 'x', score: 0, namespace: '' }];
    const out = await correctiveRetrieve('orig', recall, deps);
    expect(out.query).toBe('better query');
    expect(out.chunks[0]?.text).toContain('better query');
  });
});
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement `src/verification/crag.ts`**
```ts
import type { RetrievalResult } from '../memory/types.ts';
import { CragGrade } from './types.ts';
import type { VerifyDeps } from './types.ts';

export async function gradeRetrieval(query: string, chunks: RetrievalResult[], deps: VerifyDeps): Promise<CragGrade> {
  const ctx = chunks.map((c) => c.text).join('\n---\n') || '(no chunks)';
  const prompt = `Query: ${query}\n\nRetrieved context:\n${ctx}\n\nIs this context sufficient and relevant to answer the query? Reply with one word: CORRECT, AMBIGUOUS, or INCORRECT.`;
  const raw = (await deps.generate(deps.generalModel, prompt)).trim().toLowerCase();
  if (raw.startsWith('correct')) return CragGrade.Correct;
  if (raw.startsWith('incorrect')) return CragGrade.Incorrect;
  return CragGrade.Ambiguous;
}

export async function rewriteQuery(query: string, deps: VerifyDeps): Promise<string> {
  const raw = await deps.generate(deps.generalModel, `Rewrite this search query to retrieve better evidence. Return ONLY the rewritten query.\n\n${query}`);
  return raw.trim().split('\n')[0]!.trim() || query;
}

export async function correctiveRetrieve(
  query: string, recall: (q: string) => Promise<RetrievalResult[]>, deps: VerifyDeps,
): Promise<{ query: string; chunks: RetrievalResult[] }> {
  const rewritten = await rewriteQuery(query, deps);
  const chunks = await recall(rewritten);
  return { query: rewritten, chunks };
}
```
- [ ] **Step 4: Run tests + typecheck** → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(verification): CRAG retrieval grader + bounded corrective retrieve"`

---

