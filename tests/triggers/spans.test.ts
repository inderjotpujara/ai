import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { JobKind } from '../../src/queue/types.ts';
import {
  recordTriggerRegister,
  recordTriggerSkip,
  withTriggerFireSpan,
} from '../../src/triggers/spans.ts';
import {
  TriggerOrigin,
  TriggerOutcome,
  TriggerType,
} from '../../src/triggers/types.ts';
import { registerTestProvider } from '../helpers/otel-test-provider.ts';

const t = {
  id: 't1',
  name: 'n',
  type: TriggerType.Cron,
  enabled: true,
  target: { kind: JobKind.Chat, payload: {} },
  config: { schedule: '* * * * *' },
  origin: TriggerOrigin.Console,
  createdAt: 0,
  updatedAt: 0,
};

test('trigger span helpers are a no-op without a tracer', async () => {
  recordTriggerRegister(t); // must not throw
  const out = await withTriggerFireSpan(t, async (rec) => {
    rec.outcome(TriggerOutcome.Fired);
    return 42;
  });
  expect(out).toBe(42);
});

test('recordTriggerSkip does not throw without a tracer', () => {
  recordTriggerSkip(t, TriggerOutcome.SkippedOverlap); // must not throw
});

describe('with a registered tracer provider', () => {
  // registerTestProvider() returns { exporter, provider }; shutdown is on .provider.
  let h: ReturnType<typeof registerTestProvider>;
  beforeAll(() => {
    h = registerTestProvider();
  });
  afterAll(() => h.provider.shutdown());

  test('recordTriggerRegister emits a trigger.register span tagged id/type/origin', () => {
    recordTriggerRegister(t);
    const span = h.exporter
      .getFinishedSpans()
      .find((s) => s.name === 'trigger.register');
    expect(span).toBeDefined();
    expect(span?.attributes['trigger.id']).toBe('t1');
    expect(span?.attributes['trigger.type']).toBe(TriggerType.Cron);
    expect(span?.attributes['trigger.origin']).toBe(TriggerOrigin.Console);
  });

  test('withTriggerFireSpan emits a trigger.fire span with the reported outcome', async () => {
    await withTriggerFireSpan(t, async (rec) => {
      rec.outcome(TriggerOutcome.Fired);
      return 1;
    });
    const span = h.exporter
      .getFinishedSpans()
      .find((s) => s.name === 'trigger.fire');
    expect(span).toBeDefined();
    expect(span?.attributes['trigger.id']).toBe('t1');
    expect(span?.attributes['trigger.outcome']).toBe(TriggerOutcome.Fired);
  });

  test('recordTriggerSkip emits a trigger.skip span tagged with the given outcome', () => {
    recordTriggerSkip(t, TriggerOutcome.SkippedOverlap);
    const span = h.exporter
      .getFinishedSpans()
      .find((s) => s.name === 'trigger.skip');
    expect(span).toBeDefined();
    expect(span?.attributes['trigger.outcome']).toBe(
      TriggerOutcome.SkippedOverlap,
    );
  });

  test('no secretRef or token leaks onto any trigger span attribute', () => {
    const secrety = { ...t, secretRef: 'super-secret-value' };
    recordTriggerRegister(secrety);
    const spans = h.exporter.getFinishedSpans();
    for (const s of spans) {
      for (const v of Object.values(s.attributes)) {
        expect(String(v)).not.toContain('super-secret-value');
      }
    }
  });
});
