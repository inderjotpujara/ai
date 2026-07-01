import { describe, expect, it } from 'bun:test';
import {
  ATTR,
  annotateStep,
  withStepSpan,
  withWorkflowSpan,
} from '../../src/telemetry/spans.ts';
import { registerTestProvider } from '../helpers/otel-test-provider.ts';

describe('workflow spans', () => {
  it('nests workflow.step under workflow.run with id/kind attrs', async () => {
    const { exporter } = registerTestProvider();
    await withWorkflowSpan('wf-demo', async () => {
      await withStepSpan('s1', 'agent', async () => {
        annotateStep({ [ATTR.STEP_MAP_COUNT]: 3 });
      });
    });
    const spans = exporter.getFinishedSpans();
    const run = spans.find((s) => s.name === 'workflow.run');
    const step = spans.find((s) => s.name === 'workflow.step');
    expect(run?.attributes[ATTR.WORKFLOW_ID]).toBe('wf-demo');
    expect(step?.attributes[ATTR.STEP_ID]).toBe('s1');
    expect(step?.attributes[ATTR.STEP_KIND]).toBe('agent');
    expect(step?.attributes[ATTR.STEP_MAP_COUNT]).toBe(3);
    expect(step?.parentSpanContext?.spanId).toBe(run?.spanContext().spanId);
  });
});
