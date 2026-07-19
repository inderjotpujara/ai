import { expect, test } from 'bun:test';
import { makeRunRateLimiter } from '../../src/server/run-rate.ts';

test('run-dir creation over the window rate is refused, then resets', () => {
  const now = { t: 0 };
  const limiter = makeRunRateLimiter({
    max: 2,
    windowMs: 1000,
    now: () => now.t,
  });
  expect(limiter.allow()).toBe(true);
  expect(limiter.allow()).toBe(true);
  expect(limiter.allow()).toBe(false); // over the cap in this window
  now.t = 1001;
  expect(limiter.allow()).toBe(true); // next window resets the counter
});
