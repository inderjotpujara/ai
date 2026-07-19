import { expect, test } from 'bun:test';
import { computeConcurrency } from '../../src/queue/concurrency.ts';

test('env override wins when a positive integer', () => {
  expect(computeConcurrency({ env: '3', parallelism: () => 16 })).toBe(3);
});

test('a non-positive / non-numeric env is ignored', () => {
  expect(
    computeConcurrency({ env: '0', parallelism: () => 8 }),
  ).toBeGreaterThan(0);
  expect(
    computeConcurrency({ env: 'abc', parallelism: () => 8 }),
  ).toBeGreaterThan(0);
});

test('computed concurrency is derived from cores, floored at 1', () => {
  expect(computeConcurrency({ parallelism: () => 1 })).toBe(1);
  const many = computeConcurrency({ parallelism: () => 16 });
  expect(many).toBeGreaterThanOrEqual(1);
  expect(many).toBeLessThanOrEqual(16);
});
