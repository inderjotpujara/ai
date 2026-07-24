import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
  recordEvalRegression,
  withEvalReevalSpan,
} from '../../src/self-improve/spans.ts';
import { registerTestProvider } from '../helpers/otel-test-provider.ts';

describe('eval span helpers are a no-op without a tracer', () => {
  test('withEvalReevalSpan still runs fn and returns its value', async () => {
    const out = await withEvalReevalSpan(
      { artifact: 'a', mode: 'sweep', currentModel: 'B:7b' },
      async (rec) => {
        rec.golden(2, 3);
        rec.judge('J:32b', false);
        rec.outcome('regression');
        return 9;
      },
    );
    expect(out).toBe(9);
  });

  test('recordEvalRegression does not throw with no active span', () => {
    expect(() =>
      recordEvalRegression({
        artifact: 'a',
        regressedCount: 1,
        drop: 0.33,
        from: 'A:7b',
        to: 'B:7b',
      }),
    ).not.toThrow();
  });
});

describe('eval span helpers carry the right attrs with a tracer', () => {
  let h: ReturnType<typeof registerTestProvider>;
  beforeAll(() => {
    h = registerTestProvider();
  });
  afterAll(() => h.provider.shutdown());

  test('withEvalReevalSpan opens an eval.reeval span with the seeded + recorder attrs', async () => {
    const out = await withEvalReevalSpan(
      {
        artifact: 'agents/foo.ts',
        mode: 'sweep',
        baselineModel: 'A:7b',
        currentModel: 'B:7b',
      },
      async (rec) => {
        rec.golden(2, 3);
        rec.judge('J:32b', false);
        rec.outcome('regression');
        return 'done';
      },
    );
    expect(out).toBe('done');
    const span = h.exporter
      .getFinishedSpans()
      .find((s) => s.name === 'eval.reeval');
    expect(span).toBeDefined();
    expect(span?.attributes['eval.artifact']).toBe('agents/foo.ts');
    expect(span?.attributes['eval.mode']).toBe('sweep');
    expect(span?.attributes['eval.baseline_model']).toBe('A:7b');
    expect(span?.attributes['eval.current_model']).toBe('B:7b');
    expect(span?.attributes['gen_ai.request.model']).toBe('B:7b');
    expect(span?.attributes['verify.golden.passed']).toBe(2);
    expect(span?.attributes['verify.golden.total']).toBe(3);
    expect(span?.attributes['verify.judge.model']).toBe('J:32b');
    expect(span?.attributes['verify.judge.below_bar']).toBe(false);
    expect(span?.attributes['eval.outcome']).toBe('regression');
  });

  test('recordEvalRegression adds an eval.regression event on the active span', async () => {
    await withEvalReevalSpan(
      { artifact: 'agents/bar.ts', mode: 'pull_hook', currentModel: 'C:7b' },
      async () => {
        recordEvalRegression({
          artifact: 'agents/bar.ts',
          regressedCount: 2,
          drop: 0.4,
          from: 'B:7b',
          to: 'C:7b',
        });
      },
    );
    const span = h.exporter
      .getFinishedSpans()
      .find(
        (s) =>
          s.name === 'eval.reeval' &&
          s.attributes['eval.artifact'] === 'agents/bar.ts',
      );
    expect(span).toBeDefined();
    const event = span?.events.find((e) => e.name === 'eval.regression');
    expect(event).toBeDefined();
    expect(event?.attributes?.['eval.regressed_count']).toBe(2);
    expect(event?.attributes?.['eval.drop']).toBe(0.4);
    expect(event?.attributes?.['degrade.from']).toBe('B:7b');
    expect(event?.attributes?.['degrade.to']).toBe('C:7b');
  });
});
