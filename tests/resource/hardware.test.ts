import { expect, test } from 'bun:test';
import os from 'node:os';
import {
  availableRamBytes,
  fitsBudget,
  gpuBudgetBytes,
  liveBudgetBytes,
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

test('availableRamBytes probes a live positive figure not exceeding total RAM', async () => {
  const available = await availableRamBytes();
  expect(available).toBeGreaterThan(0);
  expect(available).toBeLessThanOrEqual(os.totalmem());
});

test('liveBudgetBytes never exceeds the Metal cap (min of metal + free gates)', async () => {
  const budget = await liveBudgetBytes();
  expect(budget).toBeGreaterThan(0);
  // Live budget is min(metal cap, free-RAM gate); it can never exceed the cap.
  expect(budget).toBeLessThanOrEqual(machineBudgetBytes());
});
