import { describe, expect, test } from 'bun:test';
import { recordGenFit } from '../../src/telemetry/spans.ts';

describe('recordGenFit', () => {
  test('is a no-op with no active span (does not throw)', () => {
    expect(() =>
      recordGenFit({
        kind: 'video',
        chosen: 'dgrauet/ltx-2.3-mlx-q4',
        fits: true,
        budgetBytes: 30_000_000_000,
        modelBytes: 14_520_000_000,
        candidates: 3,
      }),
    ).not.toThrow();
  });
});
