import { expect, test } from 'bun:test';
import {
  bytesPerWeightForQuant,
  pickBestQuantThatFits,
} from '../../src/discovery/quant.ts';

test('maps common GGUF quants to bytes/weight', () => {
  expect(bytesPerWeightForQuant('Q4_K_M')).toBeCloseTo(0.56, 2);
  expect(bytesPerWeightForQuant('Q8_0')).toBeGreaterThan(1.0);
  expect(bytesPerWeightForQuant('unknown')).toBeGreaterThan(0); // safe default
});
test('picks the largest quant whose file fits the budget', () => {
  const files = [
    { quant: 'Q4_K_M', sizeBytes: 5e9 },
    { quant: 'Q6_K', sizeBytes: 7e9 },
    { quant: 'Q8_0', sizeBytes: 9e9 },
  ];
  expect(pickBestQuantThatFits(files, 8e9)?.quant).toBe('Q6_K');
  expect(pickBestQuantThatFits(files, 4e9)).toBeUndefined();
});
