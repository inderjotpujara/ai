## Task 5: Judge (MiniCheck check + faithfulness aggregation + consent-pull)

**Files:** Create `src/verification/judge.ts`; Test `tests/verification/judge.test.ts`

**Interfaces:**
- Consumes: `VerifyDeps`, `Claim`, `Verdict`, `ClaimVerdict` (Task 1); `RetrievalResult` (memory).
- Produces: `checkClaim(claim, evidence, judgeModel, deps): Promise<boolean>`; `verifyFaithfulness(claims, evidenceById, judgeModel, fallback, threshold, deps): Promise<Verdict>`; `ensureJudgeModel(deps, ensureFn): Promise<{model,fallback}>` (thin — real consent lives in the CLI dep `deps.ensureJudge`; here just call it).

- [ ] **Step 1: Failing test** (mock `generate`: MiniCheck answers "Yes"/"No")
```ts
// tests/verification/judge.test.ts
import { describe, expect, test } from 'bun:test';
import { checkClaim, verifyFaithfulness } from '../../src/verification/judge.ts';

const yes = { generalModel: 'g', generate: async (_m: string, p: string) => (p.includes('blue') ? 'Yes' : 'No') } as any;

describe('judge', () => {
  test('checkClaim maps Yes/No → boolean', async () => {
    expect(await checkClaim('sky is blue', 'the sky is blue', 'j', yes)).toBe(true);
    expect(await checkClaim('grass is red', 'grass is green', 'j', yes)).toBe(false);
  });
  test('verifyFaithfulness aggregates + thresholds; uncited claim → unsupported', async () => {
    const claims = [
      { text: 'sky is blue', citedIds: ['a#0'] },
      { text: 'grass is red', citedIds: ['b#0'] },
      { text: 'uncited fact', citedIds: [] },
    ];
    const ev = new Map([['a#0','the sky is blue'],['b#0','grass is green']]);
    const v = await verifyFaithfulness(claims, ev, 'j', false, 0.9, yes);
    expect(v.claims.find((c) => c.claim==='sky is blue')?.supported).toBe(true);
    expect(v.claims.find((c) => c.claim==='grass is red')?.supported).toBe(false);
    expect(v.claims.find((c) => c.claim==='uncited fact')?.supported).toBe(false); // no citation → unsupported
    expect(v.faithfulness).toBeCloseTo(1/3, 5);
    expect(v.supported).toBe(false);
    expect(v.unsupportedClaims).toContain('uncited fact');
  });
});
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement `src/verification/judge.ts`**
```ts
import type { Claim, ClaimVerdict, Verdict, VerifyDeps } from './types.ts';

/** MiniCheck-style call: (document, claim) → Yes/No. Fallback uses the same shape on the general model. */
export async function checkClaim(claim: string, evidence: string, judgeModel: string, deps: VerifyDeps): Promise<boolean> {
  if (!evidence.trim()) return false;
  const prompt = `Document:\n${evidence}\n\nClaim: ${claim}\n\nIs the claim fully supported by the document? Answer only "Yes" or "No".`;
  const raw = (await deps.generate(judgeModel, prompt)).trim().toLowerCase();
  return raw.startsWith('yes');
}

export async function verifyFaithfulness(
  claims: Claim[], evidenceById: Map<string, string>, judgeModel: string, fallback: boolean, threshold: number, deps: VerifyDeps,
): Promise<Verdict> {
  const verdicts: ClaimVerdict[] = [];
  for (const c of claims) {
    if (c.citedIds.length === 0) { verdicts.push({ claim: c.text, citedIds: [], supported: false, reason: 'no citation' }); continue; }
    const evidence = c.citedIds.map((id) => evidenceById.get(id) ?? '').filter(Boolean).join('\n\n');
    const supported = await checkClaim(c.text, evidence, judgeModel, deps);
    verdicts.push({ claim: c.text, citedIds: c.citedIds, supported, reason: supported ? undefined : (evidence ? 'unsupported by cited evidence' : 'cited chunk missing') });
  }
  const total = verdicts.length || 1;
  const supportedCount = verdicts.filter((v) => v.supported).length;
  const faithfulness = supportedCount / total;
  return {
    supported: faithfulness >= threshold,
    faithfulness,
    claims: verdicts,
    unsupportedClaims: verdicts.filter((v) => !v.supported).map((v) => v.claim),
    usedFallback: fallback,
  };
}
```
- [ ] **Step 4: Run tests + typecheck** → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(verification): MiniCheck claim check + faithfulness aggregation"`

---

