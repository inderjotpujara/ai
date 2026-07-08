import { expect, test } from 'bun:test';
import type { SpanRecord } from '../../src/telemetry/jsonl-exporter.ts';
import { aggregateSpans } from '../../src/usage/aggregate.ts';

function span(
  model: string,
  inp?: number,
  out?: number,
  dur = 100,
): SpanRecord {
  return {
    name: 'agent.delegation',
    kind: 0,
    traceId: 't',
    spanId: 's',
    parentSpanId: null,
    startUnixNano: 0,
    endUnixNano: 0,
    durationMs: dur,
    status: { code: 0 },
    attributes: {
      'gen_ai.request.model': model,
      ...(inp !== undefined ? { 'gen_ai.usage.input_tokens': inp } : {}),
      ...(out !== undefined ? { 'gen_ai.usage.output_tokens': out } : {}),
    },
    events: [],
  };
}
test('aggregates tokens + duration + calls by model, tolerating missing tokens', () => {
  const rows = aggregateSpans([
    span('qwen2.5:14b', 100, 50),
    span('qwen2.5:14b'),
    span('qwen-fast', 10, 5, 40),
  ]);
  const big = rows.find((r) => r.model === 'qwen2.5:14b');
  expect(big).toEqual({
    model: 'qwen2.5:14b',
    inputTokens: 100,
    outputTokens: 50,
    durationMs: 200,
    calls: 2,
  });
});
