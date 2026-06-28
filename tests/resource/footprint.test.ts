import { expect, test } from 'bun:test';
import { estimateModelBytes } from '../../src/resource/footprint.ts';

test('estimates an 8B Q4_K_M model with 8k context', () => {
  // weights = 8e9 * 0.56 * 1.2 = 5,376,000,000 ; kv = 8192 * 131072 = 1,073,741,824
  const bytes = estimateModelBytes({
    paramsBillions: 8,
    bytesPerWeight: 0.56,
    contextTokens: 8192,
    kvBytesPerToken: 131072,
  });
  expect(bytes).toBe(5_376_000_000 + 1_073_741_824);
});

test('zero context means weights-only', () => {
  const bytes = estimateModelBytes({
    paramsBillions: 1,
    bytesPerWeight: 2,
    contextTokens: 0,
    kvBytesPerToken: 999,
  });
  expect(bytes).toBe(1e9 * 2 * 1.2);
});
