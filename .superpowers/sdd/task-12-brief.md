## Task 12: Retry policy helper — retryability classification reusing `src/reliability/classify`

**Files:**
- Create: `src/queue/retry-policy.ts`
- Create: `tests/queue/retry-policy.test.ts`

**Interfaces:**
- Consumes: `classify`/`Lane` (`src/reliability/classify.ts`). (**Breaker dropped — chosen over wiring:** an earlier draft listed `breakerFor` (`src/reliability/breaker.ts:102`) here, but a per-kind circuit breaker is deliberately NOT wired into the pool. It would add half-open/probe state for marginal benefit over the existing per-job `maxAttempts` cap + persisted `available_at` backoff, `retry-policy.ts` never actually imported it, and the reliability breaker is already scoped to its real MCP/tool/runtime call sites where a shared failure domain exists — the queue's jobs do not share one. Simpler-and-correct wins; see the self-review note.)
- Produces: `jobRetryDecision(err: unknown): { retryable: boolean }` — classifies a caught executor error into the `markFailed(id, error, retryable)` decision. Only the `Lane.Transient` class is retryable (mirrors `withRetry`'s default, `src/reliability/retry.ts:60`); permanent/policy errors are `retryable:false` → terminal `Failed`. **The backoff DELAY is no longer computed here** — it is enforced durably by `markFailed` setting `available_at` (Task 8), so the worker never sleeps holding a slot. `jobRetryDecision` is now purely the classify→retryable policy seam.

- [ ] **Step 1: Write the failing test**

`tests/queue/retry-policy.test.ts`:
```typescript
import { test, expect } from 'bun:test';
import { jobRetryDecision } from '../../src/queue/retry-policy.ts';

test('a transient-classified error is retryable', () => {
  const err = Object.assign(new Error('ECONNRESET'), { code: 'ECONNRESET' });
  expect(jobRetryDecision(err).retryable).toBe(true);
});

test('a non-transient error is not retryable', () => {
  expect(jobRetryDecision(new Error('validation: bad input')).retryable).toBe(false);
});
```

- [ ] **Step 2: Run — verify it fails**

`bun test tests/queue/retry-policy.test.ts` → FAIL.

- [ ] **Step 3: Implement `src/queue/retry-policy.ts`**

```typescript
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
```

- [ ] **Step 4: Run — verify it passes**

`bun test tests/queue/retry-policy.test.ts` → PASS (2 tests).

- [ ] **Step 5: Gate + commit**

```bash
bun run typecheck && bun run lint:file -- src/queue/retry-policy.ts tests/queue/retry-policy.test.ts
git add src/queue/retry-policy.ts tests/queue/retry-policy.test.ts
git commit -m "feat(queue): jobRetryDecision retryability via reliability classify (Slice 24 Incr 2)"
```

