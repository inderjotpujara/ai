import { describe, expect, test } from 'bun:test';
import { ATTR, withMemoryRecallSpan } from '../../src/telemetry/spans.ts';
import { registerTestProvider } from '../helpers/otel-test-provider.ts';

describe('memory spans', () => {
  test('recall span records space + counts', async () => {
    const { exporter } = registerTestProvider();
    await withMemoryRecallSpan(
      {
        space: 'default',
        namespace: 'crew:x',
        candidates: 20,
        returned: 5,
        reranked: false,
      },
      async () => 'ok',
    );
    const spans = exporter.getFinishedSpans();
    const s = spans.find((sp) => sp.name === 'memory.recall');
    expect(s).toBeDefined();
    expect(s?.attributes[ATTR.MEMORY_SPACE]).toBe('default');
    expect(s?.attributes[ATTR.MEMORY_RETURNED]).toBe(5);
  });
});
