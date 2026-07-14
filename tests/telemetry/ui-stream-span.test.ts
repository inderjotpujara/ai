import { describe, expect, it } from 'bun:test';
import { ATTR, withUiStreamSpan } from '../../src/telemetry/spans.ts';
import { registerTestProvider } from '../helpers/otel-test-provider.ts';

describe('ui.stream span', () => {
  it('records chunk count, byte count, and outcome', async () => {
    const { exporter, provider } = registerTestProvider();
    await withUiStreamSpan({ route: '/api/chat' }, async (rec) => {
      rec.chunk(10);
      rec.chunk(10);
      rec.outcome('done');
    });
    const span = exporter
      .getFinishedSpans()
      .find((s) => s.name === 'ui.stream');
    expect(span?.attributes[ATTR.SERVER_ROUTE]).toBe('/api/chat');
    expect(span?.attributes[ATTR.UI_STREAM_CHUNKS]).toBe(2);
    expect(span?.attributes[ATTR.UI_STREAM_BYTES]).toBe(20);
    expect(span?.attributes[ATTR.UI_STREAM_OUTCOME]).toBe('done');
    await provider.shutdown();
  });

  it('records resume count', async () => {
    const { exporter, provider } = registerTestProvider();
    await withUiStreamSpan({ route: '/api/chat' }, async (rec) => {
      rec.resume();
      rec.resume();
      rec.outcome('done');
    });
    const span = exporter
      .getFinishedSpans()
      .find((s) => s.name === 'ui.stream');
    expect(span?.attributes[ATTR.UI_STREAM_RESUMES]).toBe(2);
    await provider.shutdown();
  });

  it('still records aggregates on the span if fn throws', async () => {
    const { exporter, provider } = registerTestProvider();
    await expect(
      withUiStreamSpan({ route: '/api/chat' }, async (rec) => {
        rec.chunk(5);
        rec.resume();
        throw new Error('stream broke');
      }),
    ).rejects.toThrow('stream broke');
    const span = exporter
      .getFinishedSpans()
      .find((s) => s.name === 'ui.stream');
    expect(span?.attributes[ATTR.UI_STREAM_CHUNKS]).toBe(1);
    expect(span?.attributes[ATTR.UI_STREAM_BYTES]).toBe(5);
    expect(span?.attributes[ATTR.UI_STREAM_RESUMES]).toBe(1);
    expect(span?.attributes[ATTR.UI_STREAM_OUTCOME]).toBe('unknown');
    await provider.shutdown();
  });
});
