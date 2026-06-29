import { expect, test } from 'bun:test';
import qwenFast from '../../models/qwen-fast.ts';
import qwenRouter from '../../models/qwen-router.ts';

test('qwen-fast is qwen3.5:9b with a ~9B footprint', () => {
  expect(qwenFast.model).toBe('qwen3.5:9b');
  expect(qwenFast.footprint.approxParamsBillions).toBe(9);
  expect(qwenFast.footprint.bytesPerWeight).toBeGreaterThan(0);
});

test('qwen-router is qwen3.5:4b with a ~4B footprint', () => {
  expect(qwenRouter.model).toBe('qwen3.5:4b');
  expect(qwenRouter.footprint.approxParamsBillions).toBe(4);
});
