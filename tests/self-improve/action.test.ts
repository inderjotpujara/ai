import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type {
  BasicTracerProvider,
  InMemorySpanExporter,
} from '@opentelemetry/sdk-trace-base';
import { DegradeKind } from '../../src/reliability/ledger.ts';
import { applyRegressionOutcome } from '../../src/self-improve/action.ts';
import type { EvalHistoryRow } from '../../src/self-improve/history.ts';
import {
  type RegressionOutcome,
  RegressionVerdict,
} from '../../src/self-improve/regression.ts';
import { ATTR, withRunSpan } from '../../src/telemetry/spans.ts';
import type {
  EvalResult,
  ManifestEntry,
} from '../../src/verified-build/types.ts';
import { VerifiedLevel } from '../../src/verified-build/types.ts';
import { registerTestProvider } from '../helpers/otel-test-provider.ts';

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

// Task 14 review gap: steps (3) recordDegrade and (4) recordEvalRegression
// are OTel no-ops without an active span, so the tests above (which never
// register a tracer) prove nothing about whether those two calls actually
// fire, with the right attributes, or that they stay silent on every
// non-Regression verdict. These cases register a real InMemory-backed
// tracer (mirrors reliability-spans.test.ts / self-improve/spans.test.ts)
// and wrap the call in an active span so `trace.getActiveSpan()` inside
// `recordDegrade`/`recordEvalRegression` resolves to something real.
describe('applyRegressionOutcome telemetry (active tracer registered)', () => {
  let exporter: InMemorySpanExporter;
  let provider: BasicTracerProvider;

  beforeEach(() => {
    ({ exporter, provider } = registerTestProvider());
  });

  afterEach(async () => {
    await provider.shutdown();
    exporter.reset();
  });

  test('confirmed Regression fires reliability.degrade + eval.regression with the expected attrs', async () => {
    const captured = { inserted: [] as EvalHistoryRow[], upsertCalls: 0 } as {
      inserted: EvalHistoryRow[];
      upserted?: ManifestEntry;
      upsertCalls: number;
    };
    await withRunSpan('run-reg', 'sweep', async () => {
      call(
        {
          verdict: RegressionVerdict.Regression,
          regressedCaseIds: ['c0', 'c2'],
          drop: 0.2,
        },
        resultWith(),
        entryAt(VerifiedLevel.Behaves),
        captured,
      );
    });

    const span = exporter
      .getFinishedSpans()
      .find((s) => s.name === 'agent.run');
    expect(span).toBeDefined();

    const degradeEv = span?.events.find(
      (e) => e.name === 'reliability.degrade',
    );
    expect(degradeEv).toBeDefined();
    expect(degradeEv?.attributes?.[ATTR.ERROR_TYPE]).toBe(
      DegradeKind.ModelDegraded,
    );
    expect(degradeEv?.attributes?.['degrade.subject']).toBe('a');
    expect(degradeEv?.attributes?.[ATTR.RELIABILITY_DEGRADE_FROM]).toBe('A:7b');
    expect(degradeEv?.attributes?.[ATTR.RELIABILITY_DEGRADE_TO]).toBe('B:7b');

    const regressionEv = span?.events.find((e) => e.name === 'eval.regression');
    expect(regressionEv).toBeDefined();
    expect(regressionEv?.attributes?.[ATTR.EVAL_ARTIFACT]).toBe('a');
    expect(regressionEv?.attributes?.[ATTR.EVAL_REGRESSED_COUNT]).toBe(2);
    expect(regressionEv?.attributes?.[ATTR.EVAL_DROP]).toBe(0.2);
    expect(regressionEv?.attributes?.[ATTR.RELIABILITY_DEGRADE_FROM]).toBe(
      'A:7b',
    );
    expect(regressionEv?.attributes?.[ATTR.RELIABILITY_DEGRADE_TO]).toBe(
      'B:7b',
    );
  });

  test.each([
    ['WithinNoise', RegressionVerdict.WithinNoise],
    ['Pass', RegressionVerdict.Pass],
    ['Inconclusive', RegressionVerdict.Inconclusive],
  ] as const)('%s does NOT fire reliability.degrade or eval.regression', async (_label, verdict) => {
    const captured = {
      inserted: [] as EvalHistoryRow[],
      upsertCalls: 0,
    } as {
      inserted: EvalHistoryRow[];
      upserted?: ManifestEntry;
      upsertCalls: number;
    };
    await withRunSpan('run-nonreg', 'sweep', async () => {
      call(
        { verdict, regressedCaseIds: [], drop: 0 },
        resultWith({ passed: true, passedCount: 3 }),
        entryAt(VerifiedLevel.Behaves),
        captured,
      );
    });

    const span = exporter
      .getFinishedSpans()
      .find((s) => s.name === 'agent.run');
    expect(span).toBeDefined();
    expect(
      span?.events.find((e) => e.name === 'reliability.degrade'),
    ).toBeUndefined();
    expect(
      span?.events.find((e) => e.name === 'eval.regression'),
    ).toBeUndefined();
  });
});
