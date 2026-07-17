import { describe, expect, test } from 'bun:test';
import { ATTR, withMemoryRememberSpan } from '../../src/telemetry/spans.ts';
import { registerTestProvider } from '../helpers/otel-test-provider.ts';

describe('withMemoryRememberSpan', () => {
  test('records space + namespace + skipped', async () => {
    const { exporter } = registerTestProvider();
    await withMemoryRememberSpan(
      { space: 'chat', namespace: 'sess-1' },
      async () => ({ skipped: false }),
    );
    const span = exporter
      .getFinishedSpans()
      .find((s) => s.name === 'memory.remember');
    expect(span).toBeDefined();
    expect(span?.attributes[ATTR.MEMORY_SPACE]).toBe('chat');
    expect(span?.attributes[ATTR.MEMORY_NAMESPACE]).toBe('sess-1');
    expect(span?.attributes[ATTR.MEMORY_REMEMBER_SKIPPED]).toBe(false);
  });

  test('records skipped:true when the wrapped call reports a dedup-skip', async () => {
    const { exporter } = registerTestProvider();
    await withMemoryRememberSpan({ space: 'chat' }, async () => ({
      skipped: true,
    }));
    const span = exporter
      .getFinishedSpans()
      .find((s) => s.name === 'memory.remember');
    expect(span?.attributes[ATTR.MEMORY_REMEMBER_SKIPPED]).toBe(true);
  });

  test('omits the namespace attribute when none is given', async () => {
    const { exporter } = registerTestProvider();
    await withMemoryRememberSpan({ space: 'chat' }, async () => ({
      skipped: false,
    }));
    const span = exporter
      .getFinishedSpans()
      .find((s) => s.name === 'memory.remember');
    expect(span?.attributes[ATTR.MEMORY_NAMESPACE]).toBeUndefined();
  });
});
