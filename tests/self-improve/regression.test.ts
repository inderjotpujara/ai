import { expect, test } from 'bun:test';
import {
  decideRegression,
  RegressionVerdict,
} from '../../src/self-improve/regression.ts';

const ev = (perCase: { id: string; passed: boolean }[], belowBar = false) => ({
  passed: perCase.every((c) => c.passed),
  total: perCase.length,
  passedCount: perCase.filter((c) => c.passed).length,
  perCase: perCase.map((c) => ({ ...c, detail: '' })),
  judgeModel: 'J:32b',
  belowBar,
});
const noRerun = async () => ({});

test('no regressed cases → Pass', async () => {
  const out = await decideRegression({
    baseline: ev([
      { id: 'c0', passed: true },
      { id: 'c1', passed: true },
    ]),
    fresh: ev([
      { id: 'c0', passed: true },
      { id: 'c1', passed: true },
    ]),
    hysteresis: 0.15,
    rerunCases: 2,
    rerun: noRerun,
  });
  expect(out.verdict).toBe(RegressionVerdict.Pass);
  expect(out.regressedCaseIds).toEqual([]);
  expect(out.drop).toBe(0);
});

test('flip-then-recover is noise → WithinNoise, NOT a demote', async () => {
  const out = await decideRegression({
    baseline: ev([
      { id: 'c0', passed: true },
      { id: 'c1', passed: true },
      { id: 'c2', passed: true },
    ]),
    fresh: ev([
      { id: 'c0', passed: false },
      { id: 'c1', passed: true },
      { id: 'c2', passed: true },
    ]),
    hysteresis: 0.15,
    rerunCases: 2,
    rerun: async () => ({ c0: [false, true] }), // recovered on the 2nd re-run
  });
  expect(out.verdict).toBe(RegressionVerdict.WithinNoise);
  expect(out.regressedCaseIds).toEqual([]);
});

test('unanimous-fail across K re-runs AND drop > H → Regression', async () => {
  const base = Array.from({ length: 5 }, (_, i) => ({
    id: `c${i}`,
    passed: true,
  }));
  const fresh = base.map((c) => (c.id === 'c0' ? { ...c, passed: false } : c));
  const out = await decideRegression({
    baseline: ev(base),
    fresh: ev(fresh),
    hysteresis: 0.15,
    rerunCases: 2,
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
    baseline: ev([
      { id: 'c0', passed: true },
      { id: 'c1', passed: true },
      { id: 'c2', passed: false },
    ]),
    fresh: ev([
      { id: 'c0', passed: false },
      { id: 'c1', passed: true },
      { id: 'c2', passed: true },
    ]),
    hysteresis: 0.0,
    rerunCases: 1, // H=0 so any confirmed regression clears it
    rerun: async () => ({ c0: [false] }),
  });
  expect(out.regressedCaseIds).toEqual(['c0']); // c2 improving does NOT offset c0 regressing
  expect(out.verdict).toBe(RegressionVerdict.Regression);
});

test('drop == H is NOT a regression (strict >)', async () => {
  const base = Array.from({ length: 20 }, (_, i) => ({
    id: `c${i}`,
    passed: true,
  }));
  const fresh = base.map((c) =>
    ['c0', 'c1', 'c2'].includes(c.id) ? { ...c, passed: false } : c,
  );
  const out = await decideRegression({
    baseline: ev(base),
    fresh: ev(fresh),
    hysteresis: 0.15,
    rerunCases: 1,
    rerun: async () => ({ c0: [false], c1: [false], c2: [false] }),
  });
  // drop = 3/20 = 0.15 === H → within noise
  expect(out.drop).toBeCloseTo(0.15);
  expect(out.verdict).toBe(RegressionVerdict.WithinNoise);
});

test('drop just over H IS a regression', async () => {
  // 4/20 confirmed = 0.20 > 0.15; but tighter: 4/20 → use hysteresis just below.
  const base = Array.from({ length: 20 }, (_, i) => ({
    id: `c${i}`,
    passed: true,
  }));
  const fresh = base.map((c) =>
    ['c0', 'c1', 'c2'].includes(c.id) ? { ...c, passed: false } : c,
  );
  const out = await decideRegression({
    baseline: ev(base),
    fresh: ev(fresh),
    hysteresis: 0.149, // drop = 0.15 is just OVER 0.149
    rerunCases: 1,
    rerun: async () => ({ c0: [false], c1: [false], c2: [false] }),
  });
  expect(out.drop).toBeCloseTo(0.15);
  expect(out.verdict).toBe(RegressionVerdict.Regression);
  expect(out.regressedCaseIds).toEqual(['c0', 'c1', 'c2']);
});

test('belowBar judge → Inconclusive, never a demote', async () => {
  const out = await decideRegression({
    baseline: ev([{ id: 'c0', passed: true }]),
    fresh: ev([{ id: 'c0', passed: false }], true),
    hysteresis: 0.15,
    rerunCases: 2,
    rerun: noRerun,
  });
  expect(out.verdict).toBe(RegressionVerdict.Inconclusive);
  expect(out.regressedCaseIds).toEqual([]);
  expect(out.drop).toBe(0);
});
