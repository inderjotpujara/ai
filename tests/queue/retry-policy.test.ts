import { expect, test } from 'bun:test';
import { jobRetryDecision } from '../../src/queue/retry-policy.ts';

test('a transient-classified error is retryable', () => {
  const err = Object.assign(new Error('ECONNRESET'), { code: 'ECONNRESET' });
  expect(jobRetryDecision(err).retryable).toBe(true);
});

test('a non-transient error is not retryable', () => {
  expect(jobRetryDecision(new Error('validation: bad input')).retryable).toBe(
    false,
  );
});
