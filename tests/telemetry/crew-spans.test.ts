import { describe, expect, it } from 'bun:test';
import { ATTR, withCrewSpan, withStepSpan } from '../../src/telemetry/spans.ts';
import { registerTestProvider } from '../helpers/otel-test-provider.ts';

describe('crew spans', () => {
  it('opens crew.run with id + process and nests child spans under it', async () => {
    const { exporter } = registerTestProvider();
    await withCrewSpan('research-crew', 'sequential', async () => {
      await withStepSpan('t1', 'agent', async () => {});
    });
    const spans = exporter.getFinishedSpans();
    const crew = spans.find((s) => s.name === 'crew.run');
    const step = spans.find((s) => s.name === 'workflow.step');
    expect(crew?.attributes[ATTR.CREW_ID]).toBe('research-crew');
    expect(crew?.attributes[ATTR.CREW_PROCESS]).toBe('sequential');
    expect(step?.parentSpanContext?.spanId).toBe(crew?.spanContext().spanId);
  });
});
