import { expect, test } from 'bun:test';
import { applyRegressionOutcome } from '../../src/self-improve/action.ts';
import type { EvalHistoryRow } from '../../src/self-improve/history.ts';
import {
  type RegressionOutcome,
  RegressionVerdict,
} from '../../src/self-improve/regression.ts';
import type {
  EvalResult,
  ManifestEntry,
} from '../../src/verified-build/types.ts';
import { VerifiedLevel } from '../../src/verified-build/types.ts';

const entryAt = (level: VerifiedLevel): ManifestEntry => ({
  need: 'summarize',
  signature: {
    purpose: 'summarize',
    tools: [],
    modelTier: '',
    io: '',
    roles: [],
  },
  vector: [],
  verifiedLevel: level,
  goldenPath: '/d/a.golden.json',
  createdAtMs: 1,
  lastUsedMs: 0,
  useCount: 0,
  lastEvalPass: true,
});

const resultWith = (over: Partial<EvalResult> = {}): EvalResult => ({
  passed: false,
  total: 3,
  passedCount: 2,
  perCase: [
    { id: 'c0', passed: false, detail: '' },
    { id: 'c1', passed: true, detail: '' },
    { id: 'c2', passed: true, detail: '' },
  ],
  judgeModel: 'J:32b',
  belowBar: false,
  ...over,
});

const fakeStore = (sink: EvalHistoryRow[]) => ({
  insert: (r: EvalHistoryRow): void => {
    sink.push(r);
  },
  listByArtifact: (): EvalHistoryRow[] => [],
  latestPassing: (): EvalHistoryRow | undefined => undefined,
  close: (): void => {},
});

const call = (
  outcome: RegressionOutcome,
  result: EvalResult,
  entry: ManifestEntry,
  captured: {
    inserted: EvalHistoryRow[];
    upserted?: ManifestEntry;
    upsertCalls: number;
  },
) =>
  applyRegressionOutcome(
    {
      dir: '/d',
      name: 'a',
      entry,
      outcome,
      result,
      currentModel: 'B:7b',
      baselineModel: 'A:7b',
      reason: 'sweep',
    },
    {
      history: fakeStore(captured.inserted),
      upsertEntry: (_d, _n, e): void => {
        captured.upserted = e;
        captured.upsertCalls += 1;
      },
      now: () => 5,
    },
  );

test('confirmed Regression demotes Behaves→Unverified and records a regressed row', () => {
  const captured = { inserted: [] as EvalHistoryRow[], upsertCalls: 0 } as {
    inserted: EvalHistoryRow[];
    upserted?: ManifestEntry;
    upsertCalls: number;
  };
  const r = call(
    {
      verdict: RegressionVerdict.Regression,
      regressedCaseIds: ['c0'],
      drop: 0.2,
    },
    resultWith(),
    entryAt(VerifiedLevel.Behaves),
    captured,
  );
  expect(r.demoted).toBe(true);
  expect(captured.upsertCalls).toBe(1);
  expect(captured.upserted?.verifiedLevel).toBe(VerifiedLevel.Unverified);
  expect(captured.upserted?.lastEvalPass).toBe(false);
  expect(captured.inserted).toHaveLength(1);
  expect(captured.inserted[0]).toMatchObject({
    artifactId: 'a',
    regressed: true,
    model: 'B:7b',
    baselineModel: 'A:7b',
    ts: 5,
    passed: false,
    passedCount: 2,
    total: 3,
    judgeModel: 'J:32b',
    reason: 'sweep',
  });
  expect(captured.inserted[0]?.perCase).toHaveLength(3);
  expect(typeof captured.inserted[0]?.id).toBe('string');
});

test('WithinNoise records a NON-regressed row and does NOT demote', () => {
  const captured = { inserted: [] as EvalHistoryRow[], upsertCalls: 0 } as {
    inserted: EvalHistoryRow[];
    upserted?: ManifestEntry;
    upsertCalls: number;
  };
  const r = call(
    {
      verdict: RegressionVerdict.WithinNoise,
      regressedCaseIds: ['c0'],
      drop: 0.05,
    },
    resultWith({ passed: true, passedCount: 3 }),
    entryAt(VerifiedLevel.Behaves),
    captured,
  );
  expect(r.demoted).toBe(false);
  expect(captured.upsertCalls).toBe(0);
  expect(captured.inserted).toHaveLength(1);
  expect(captured.inserted[0]?.regressed).toBe(false);
});

test('Pass records a row and does NOT demote', () => {
  const captured = { inserted: [] as EvalHistoryRow[], upsertCalls: 0 } as {
    inserted: EvalHistoryRow[];
    upserted?: ManifestEntry;
    upsertCalls: number;
  };
  const r = call(
    { verdict: RegressionVerdict.Pass, regressedCaseIds: [], drop: 0 },
    resultWith({ passed: true, passedCount: 3 }),
    entryAt(VerifiedLevel.Behaves),
    captured,
  );
  expect(r.demoted).toBe(false);
  expect(captured.upsertCalls).toBe(0);
  expect(captured.inserted[0]?.regressed).toBe(false);
});

test('Inconclusive records a row (belowBar true) and does NOT demote', () => {
  const captured = { inserted: [] as EvalHistoryRow[], upsertCalls: 0 } as {
    inserted: EvalHistoryRow[];
    upserted?: ManifestEntry;
    upsertCalls: number;
  };
  const r = call(
    { verdict: RegressionVerdict.Inconclusive, regressedCaseIds: [], drop: 0 },
    resultWith({ belowBar: true }),
    entryAt(VerifiedLevel.Behaves),
    captured,
  );
  expect(r.demoted).toBe(false);
  expect(captured.upsertCalls).toBe(0);
  expect(captured.inserted).toHaveLength(1);
  expect(captured.inserted[0]?.belowBar).toBe(true);
  expect(captured.inserted[0]?.regressed).toBe(false);
});

test('demote is idempotent — an already-Unverified entry is a safe re-write', () => {
  const captured = { inserted: [] as EvalHistoryRow[], upsertCalls: 0 } as {
    inserted: EvalHistoryRow[];
    upserted?: ManifestEntry;
    upsertCalls: number;
  };
  const r = call(
    {
      verdict: RegressionVerdict.Regression,
      regressedCaseIds: ['c0'],
      drop: 0.2,
    },
    resultWith(),
    entryAt(VerifiedLevel.Unverified),
    captured,
  );
  expect(r.demoted).toBe(true);
  expect(captured.upsertCalls).toBe(1);
  expect(captured.upserted?.verifiedLevel).toBe(VerifiedLevel.Unverified);
});

test('omitted baselineModel/reason are left absent on the row', () => {
  const inserted: EvalHistoryRow[] = [];
  const r = applyRegressionOutcome(
    {
      dir: '/d',
      name: 'a',
      entry: entryAt(VerifiedLevel.Behaves),
      outcome: {
        verdict: RegressionVerdict.Pass,
        regressedCaseIds: [],
        drop: 0,
      },
      result: resultWith({ passed: true, passedCount: 3 }),
      currentModel: 'B:7b',
    },
    {
      history: fakeStore(inserted),
      upsertEntry: (): void => {},
      now: () => 9,
    },
  );
  expect(r.demoted).toBe(false);
  expect(inserted[0]?.baselineModel).toBeUndefined();
  expect(inserted[0]?.reason).toBeUndefined();
});
