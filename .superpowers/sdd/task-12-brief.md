### Task 12: `src/self-improve/regression.ts` — `decideRegression` (ADVERSARIAL-VERIFY §7.1)

**Files:**
- Create: `src/self-improve/regression.ts`
- Test: `tests/self-improve/regression.test.ts`

**Interfaces:**
- Consumes: `EvalResult`, `EvalCaseResult` from `../verified-build/types.ts`.
- Produces:
  ```ts
  export enum RegressionVerdict {
    Pass = 'pass', Regression = 'regression', WithinNoise = 'within-noise', Inconclusive = 'inconclusive',
  }
  export type RegressionInput = {
    baseline: EvalResult;
    fresh: EvalResult;
    hysteresis: number;   // H (AGENT_REEVAL_HYSTERESIS)
    rerunCases: number;   // K (AGENT_REEVAL_RERUN_CASES)
    /** Re-run ONLY these case ids `count` extra times each on the SAME resolved
     *  model + judge; returns per-case pass/fail across the `count` runs. */
    rerun: (caseIds: string[], count: number) => Promise<Record<string, boolean[]>>;
  };
  export type RegressionOutcome = {
    verdict: RegressionVerdict;
    regressedCaseIds: string[]; // confirmed-regressed
    drop: number;               // aggregate drop over confirmed
  };
  export async function decideRegression(input: RegressionInput): Promise<RegressionOutcome>;
  ```
  Algorithm (spec §D4, verbatim):
  1. If `fresh.belowBar` → `{ verdict: Inconclusive, regressedCaseIds: [], drop: 0 }` (NO demote; judge unavailable at eval time).
  2. `regressed = fresh.perCase.filter(c => baseline case passed AND fresh case failed)` (per-case; index by id from `baseline.perCase`). If empty → `{ verdict: Pass, [], 0 }`.
  3. `const rr = await rerun(regressed.map(c=>c.id), K);` A case is CONFIRMED only if it failed on EVERY re-run (`rr[id].every(x => x === false)`). A case that recovered on any re-run is noise → dropped. `confirmed = regressed.filter(c => rr[c.id]?.every(x => !x))`.
  4. `drop = confirmed.length / baseline.total` (equivalently `baseline.passedCount/total − (baseline.passedCount − confirmed.length)/total`).
  5. `real = confirmed.length >= 1 AND drop > H`. `real` → `{ Regression, confirmed ids, drop }`; else → `{ WithinNoise, confirmed ids, drop }` (NO demote).
  - **Boundary:** `drop === H` is NOT a regression (strict `>`); `drop` just over H IS.

- [ ] **Step 1: Write the failing tests** — the §7.1 case battery:

```ts
import { expect, test } from 'bun:test';
import { decideRegression, RegressionVerdict } from '../../src/self-improve/regression.ts';

const ev = (perCase: { id: string; passed: boolean }[], belowBar = false) => ({
  passed: perCase.every((c) => c.passed), total: perCase.length,
  passedCount: perCase.filter((c) => c.passed).length,
  perCase: perCase.map((c) => ({ ...c, detail: '' })), judgeModel: 'J:32b', belowBar,
});
const noRerun = async () => ({});

test('no regressed cases → Pass', async () => {
  const out = await decideRegression({
    baseline: ev([{ id: 'c0', passed: true }, { id: 'c1', passed: true }]),
    fresh: ev([{ id: 'c0', passed: true }, { id: 'c1', passed: true }]),
    hysteresis: 0.15, rerunCases: 2, rerun: noRerun,
  });
  expect(out.verdict).toBe(RegressionVerdict.Pass);
});

test('flip-then-recover is noise → WithinNoise, NOT a demote', async () => {
  const out = await decideRegression({
    baseline: ev([{ id: 'c0', passed: true }, { id: 'c1', passed: true }, { id: 'c2', passed: true }]),
    fresh: ev([{ id: 'c0', passed: false }, { id: 'c1', passed: true }, { id: 'c2', passed: true }]),
    hysteresis: 0.15, rerunCases: 2,
    rerun: async () => ({ c0: [false, true] }), // recovered on the 2nd re-run
  });
  expect(out.verdict).toBe(RegressionVerdict.WithinNoise);
  expect(out.regressedCaseIds).toEqual([]);
});

test('unanimous-fail across K re-runs AND drop > H → Regression', async () => {
  const base = Array.from({ length: 5 }, (_, i) => ({ id: `c${i}`, passed: true }));
  const fresh = base.map((c) => (c.id === 'c0' ? { ...c, passed: false } : c));
  const out = await decideRegression({
    baseline: ev(base), fresh: ev(fresh),
    hysteresis: 0.15, rerunCases: 2,
    rerun: async () => ({ c0: [false, false] }),
  });
  // drop = 1/5 = 0.2 > 0.15
  expect(out.verdict).toBe(RegressionVerdict.Regression);
  expect(out.regressedCaseIds).toEqual(['c0']);
  expect(out.drop).toBeCloseTo(0.2);
});

test('aggregate-flat but ONE case flipped is caught by the per-case predicate', async () => {
  // baseline 2/3 pass; fresh also 2/3 pass but a DIFFERENT case now passes/fails
  const out = await decideRegression({
    baseline: ev([{ id: 'c0', passed: true }, { id: 'c1', passed: true }, { id: 'c2', passed: false }]),
    fresh: ev([{ id: 'c0', passed: false }, { id: 'c1', passed: true }, { id: 'c2', passed: true }]),
    hysteresis: 0.0, rerunCases: 1, // H=0 so any confirmed regression clears it
    rerun: async () => ({ c0: [false] }),
  });
  expect(out.regressedCaseIds).toEqual(['c0']); // c2 improving does NOT offset c0 regressing
  expect(out.verdict).toBe(RegressionVerdict.Regression);
});

test('drop == H is NOT a regression (strict >)', async () => {
  const base = Array.from({ length: 20 }, (_, i) => ({ id: `c${i}`, passed: true }));
  const fresh = base.map((c) => (['c0', 'c1', 'c2'].includes(c.id) ? { ...c, passed: false } : c));
  const out = await decideRegression({
    baseline: ev(base), fresh: ev(fresh), hysteresis: 0.15, rerunCases: 1,
    rerun: async () => ({ c0: [false], c1: [false], c2: [false] }),
  });
  // drop = 3/20 = 0.15 === H → within noise
  expect(out.drop).toBeCloseTo(0.15);
  expect(out.verdict).toBe(RegressionVerdict.WithinNoise);
});

test('belowBar judge → Inconclusive, never a demote', async () => {
  const out = await decideRegression({
    baseline: ev([{ id: 'c0', passed: true }]),
    fresh: ev([{ id: 'c0', passed: false }], true),
    hysteresis: 0.15, rerunCases: 2, rerun: noRerun,
  });
  expect(out.verdict).toBe(RegressionVerdict.Inconclusive);
});
```

- [ ] **Step 2: Run tests to verify they fail** → FAIL.
- [ ] **Step 3: Write minimal implementation** per the algorithm; pure + async only for the injected `rerun`. Early returns for the belowBar / no-regressed / confirmed-empty branches.
- [ ] **Step 4: Run tests to verify they pass** — `bun run test:file -- "tests/self-improve/regression.test.ts"` → PASS (all six).
- [ ] **Step 5: Gate + commit** — `bun run typecheck && bun run lint:file -- src/self-improve/regression.ts tests/self-improve/regression.test.ts`.

```bash
git add src/self-improve/regression.ts tests/self-improve/regression.test.ts
git commit -m "feat(self-improve): noise-robust regression decision (per-case + bounded unanimous-fail re-run + hysteresis)"
```

*Model: **Opus implementer + ADVERSARIAL-VERIFY (§7.1).** Reviewer probes: can ANY path demote on a single below-bar run? Is the per-case predicate keyed on the baseline case's own prior verdict (not the aggregate)? Is the hysteresis strictly `>` (drop==H is within-noise)? Does a case that recovers on ANY re-run get dropped from the confirmed set?*

