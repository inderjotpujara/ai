import { classify, Lane } from '../reliability/classify.ts';

/**
 * Whether a failed job should re-queue. Reuses Slice 21's error classifier
 * (src/reliability/classify.ts) rather than a second policy: only the Transient
 * lane retries (mirrors withRetry's default); everything else is a terminal
 * Failed. The re-claim DELAY is NOT computed here — it is enforced durably by
 * markFailed setting `available_at` (Task 8, using the reliability backoff
 * knobs), so the worker pool never sleeps holding a slot.
 */
export function jobRetryDecision(err: unknown): { retryable: boolean } {
  return { retryable: classify(err) === Lane.Transient };
}
