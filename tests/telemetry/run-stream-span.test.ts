import { describe, expect, it } from 'bun:test';
import { ATTR, withRunStreamSpan } from '../../src/telemetry/spans.ts';
import { registerTestProvider } from '../helpers/otel-test-provider.ts';

describe('runs.stream span', () => {
  it('aggregates chunks/bytes/resumes/outcome + runId', async () => {
    const { exporter, provider } = registerTestProvider();
    await withRunStreamSpan(
      { route: '/api/runs/r1/stream', runId: 'r1' },
      async (rec) => {
        rec.chunk(10);
        rec.chunk(20);
        rec.resume();
        rec.outcome('done');
      },
    );
    const span = exporter
      .getFinishedSpans()
      .find((s) => s.name === 'runs.stream');
    expect(span?.attributes[ATTR.RUN_STREAM_CHUNKS]).toBe(2);
    expect(span?.attributes[ATTR.RUN_STREAM_BYTES]).toBe(30);
    expect(span?.attributes[ATTR.RUN_STREAM_RESUMES]).toBe(1);
    expect(span?.attributes[ATTR.RUN_STREAM_OUTCOME]).toBe('done');
    expect(span?.attributes[ATTR.RUN_STREAM_RUN_ID]).toBe('r1');
    await provider.shutdown();
  });

  it('still records aggregates on the span if fn throws', async () => {
    const { exporter, provider } = registerTestProvider();
    await expect(
      withRunStreamSpan(
        { route: '/api/runs/r1/stream', runId: 'r1' },
        async (rec) => {
          rec.chunk(5);
          rec.resume();
          throw new Error('tail broke');
        },
      ),
    ).rejects.toThrow('tail broke');
    const span = exporter
      .getFinishedSpans()
      .find((s) => s.name === 'runs.stream');
    expect(span?.attributes[ATTR.RUN_STREAM_CHUNKS]).toBe(1);
    expect(span?.attributes[ATTR.RUN_STREAM_BYTES]).toBe(5);
    expect(span?.attributes[ATTR.RUN_STREAM_RESUMES]).toBe(1);
    expect(span?.attributes[ATTR.RUN_STREAM_OUTCOME]).toBe('unknown');
    await provider.shutdown();
  });
});
