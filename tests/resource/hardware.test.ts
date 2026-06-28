import { expect, test } from 'bun:test';
import {
  fitsBudget,
  gpuBudgetBytes,
  machineBudgetBytes,
} from '../../src/resource/hardware.ts';

test('gpu budget is 75% of total ram, floored', () => {
  expect(gpuBudgetBytes(24 * 1024 ** 3)).toBe(
    Math.floor(24 * 1024 ** 3 * 0.75),
  );
});

test('fitsBudget compares model size to budget', () => {
  expect(fitsBudget(5_000_000_000, 18_000_000_000)).toBe(true);
  expect(fitsBudget(20_000_000_000, 18_000_000_000)).toBe(false);
});

test('machineBudgetBytes returns a positive number for this machine', () => {
  expect(machineBudgetBytes()).toBeGreaterThan(0);
});
