import { describe, expect, test } from 'bun:test';
import {
  ATTR,
  recordVerdict,
  withVerificationSpan,
} from '../../src/telemetry/spans.ts';
import { registerTestProvider } from '../helpers/otel-test-provider.ts';

describe('verification span', () => {
  test('emits verification.check with supported + faithfulness', async () => {
    const { exporter } = registerTestProvider();
    await withVerificationSpan(
      {
        supported: false,
        faithfulness: 0.5,
        crag: 'incorrect',
        retries: 1,
        fallback: false,
      },
      async () => 'x',
    );
    const spans = exporter.getFinishedSpans();
    const s = spans.find((sp) => sp.name === 'verification.check');
    expect(s).toBeDefined();
    expect(s?.attributes[ATTR.VERIFICATION_SUPPORTED]).toBe(false);
    expect(s?.attributes[ATTR.VERIFICATION_FAITHFULNESS]).toBe(0.5);
    expect(s?.attributes[ATTR.VERIFICATION_CRAG_GRADE]).toBe('incorrect');
    expect(s?.attributes[ATTR.VERIFICATION_RETRIES]).toBe(1);
    expect(s?.attributes[ATTR.VERIFICATION_FALLBACK]).toBe(false);
  });

  test('recordVerdict sets unsupported claim count on the active span', async () => {
    const { exporter } = registerTestProvider();
    await withVerificationSpan({ supported: true }, async () => {
      recordVerdict(2);
    });
    const spans = exporter.getFinishedSpans();
    const s = spans.find((sp) => sp.name === 'verification.check');
    expect(s?.attributes[ATTR.VERIFICATION_UNSUPPORTED]).toBe(2);
  });
});
