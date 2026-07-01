## Task 7: `verify()` primitive

**Files:** Create `src/verification/verify.ts`; Test `tests/verification/verify.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1/4/5; `withVerificationSpan` (Task 2); `VerificationError`.
- Produces: `verify(answer: string, opts: { query: string; space: string; threshold?: number }, deps: VerifyDeps): Promise<Verdict>`.

- [ ] **Step 1: Failing test** (mock deps end-to-end)
```ts
// tests/verification/verify.test.ts
import { describe, expect, test } from 'bun:test';
import { verify } from '../../src/verification/verify.ts';

function deps(over: Partial<any> = {}): any {
  return {
    generalModel: 'g',
    ensureJudge: async (m: string) => ({ model: m, fallback: false }),
    generate: async (_m: string, p: string) => {
      if (p.includes('atomic factual claims')) return '[{"text":"Raft elects a leader","citedIds":["r#0"]}]';
      return p.includes('Raft') ? 'Yes' : 'No'; // checkClaim
    },
    getByIds: async (_s: string, ids: string[]) => ids.map((id) => ({ id, text: 'Raft elects a leader via timeouts', source: 'kb', score: 0, namespace: '' })),
    ...over,
  };
}

describe('verify', () => {
  test('grounded answer → supported', async () => {
    const v = await verify('Raft elects a leader [mem:r#0]', { query: 'raft leader', space: 'default' }, deps());
    expect(v.supported).toBe(true);
    expect(v.faithfulness).toBe(1);
  });
  test('no citations → abstain-worthy (faithfulness 0)', async () => {
    const d = deps({ generate: async (_m: string, p: string) => (p.includes('atomic') ? '[{"text":"Uncited claim","citedIds":[]}]' : 'No') });
    const v = await verify('Uncited claim', { query: 'q', space: 'default' }, d);
    expect(v.supported).toBe(false);
    expect(v.faithfulness).toBe(0);
  });
});
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement `src/verification/verify.ts`**
```ts
import { withVerificationSpan } from '../telemetry/spans.ts';
import { verifyThreshold } from './config.ts';
import { decomposeClaims } from './claims.ts';
import { verifyFaithfulness } from './judge.ts';
import type { Verdict, VerifyDeps } from './types.ts';

export async function verify(
  answer: string, opts: { query: string; space: string; threshold?: number }, deps: VerifyDeps,
): Promise<Verdict> {
  const threshold = opts.threshold ?? verifyThreshold();
  const claims = await decomposeClaims(answer, deps);
  const allIds = [...new Set(claims.flatMap((c) => c.citedIds))];
  const judge = await deps.ensureJudge(deps.generalModel); // model id resolved by caller; see wiring
  const evidence = allIds.length ? await deps.getByIds(opts.space, allIds) : [];
  const evidenceById = new Map(evidence.map((e) => [e.id, e.text]));
  return withVerificationSpan({}, async () => {
    const verdict: Verdict = await verifyFaithfulness(claims, evidenceById, judge.model, judge.fallback, threshold, deps);
    // annotate the span from the computed verdict
    return verdict;
  });
}
```
> Note: `ensureJudge` here is passed the desired judge model by the CLI wiring (Task 10) — the primitive stays agnostic; tests inject a fake returning `{model, fallback}`. If you prefer, thread the judge model via `opts` — keep it consistent with the wiring task and the test.

- [ ] **Step 4: Run tests + typecheck** → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(verification): verify() primitive (decompose→evidence→judge)"`

---

