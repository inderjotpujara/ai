# Task 4: withRetry + parseRetryAfter + abortableSleep — Implementation Report

## Status
**COMPLETE** — all tests pass, typecheck ✓, lint ✓, commit pushed.

## Commit
- **SHA**: `be3b81fbcc9bd2bf47785073d5d1a90f2be07ff8`
- **Subject**: `feat(reliability): withRetry (Transient-only, Retry-After aware) + abortableSleep`

## Files Created
1. `/Users/inderjotsingh/ai/src/reliability/retry.ts` (72 lines)
2. `/Users/inderjotsingh/ai/tests/reliability/retry.test.ts` (99 lines)

## Implementation Details

### `abortableSleep(ms: number, signal?: AbortSignal): Promise<void>`
- Returns immediately if `ms <= 0`.
- If no signal, uses native `setTimeout`.
- If signal provided, listens for abort and resolves early on abort.
- Uses event listener cleanup to avoid memory leaks.

### `parseRetryAfter(err: unknown): number | undefined`
- Reads `retry-after` or `Retry-After` header from `err.responseHeaders`.
- Parses as seconds (number) and converts to milliseconds.
- Returns `undefined` if header absent or invalid (non-finite or negative).

### `withRetry<T>(fn: () => Promise<T>, opts?: RetryOpts): Promise<T>`
- **Default retryability**: Only retries `Lane.Transient` errors (via `classify()`).
- **Custom retryability**: Honors `opts.retryable` predicate to override defaults.
- **Backoff**: Full-jitter exponential backoff (formula: `jitter() * Math.min(capMs, baseMs * 2^attempt)`).
- **Retry-After override**: `parseRetryAfter()` can override computed backoff if header present.
- **AbortSignal support**: Stops re-attempts if signal aborts (first attempt still runs).
- **Non-retryable errors throw immediately** (no backoff, no retry count consumed).
- **Exhaustion**: Throws the last error after `attempts` attempts (default from `maxAttempts()`).

### Signature
```typescript
export type RetryOpts = {
  attempts?: number;
  baseMs?: number;
  capMs?: number;
  jitter?: () => number;
  onRetry?: (n: number) => void;
  signal?: AbortSignal;
  retryable?: (err: unknown) => boolean;
};

export async function withRetry<T>(fn: () => Promise<T>, opts?: RetryOpts): Promise<T>
```

## Test Coverage (10 tests, all pass)

### withRetry (6 tests)
1. **First success** — no retries on success.
2. **Transient error + retry** — retries ECONNRESET 3 times with zero backoff.
3. **RouteWorthy error** — ProviderError throws immediately (1 attempt, no retry).
4. **Exhaustion** — gives up after N attempts and throws last error.
5. **AbortSignal** — stops re-attempts when signal is already aborted (first attempt runs).
6. **Custom retryable** — honors a falsy predicate (ResourceError treated as non-retryable).

### abortableSleep (2 tests)
1. **Immediate resolve** — resolves immediately for `ms <= 0`.
2. **Early abort** — resolves early when signal is aborted (no hang).

### parseRetryAfter (2 tests)
1. **Header present** — reads `retry-after: 2` → 2000ms.
2. **Header absent** — returns `undefined`.

## Evidence

### Test Results (focused)
```
10 pass
0 fail
16 expect() calls
Ran 10 tests across 1 file. [57-59ms]
```

### Lint
```
bun run lint:file -- "src/reliability/retry.ts" "tests/reliability/retry.test.ts"
Checked 2 files in 4ms. No fixes applied.
```

### Typecheck
```
bun run typecheck
# (no output = success)
```

### Pre-commit Hook (docs-check)
```
✔ docs-check: living docs present + linked; every src subsystem documented.
```

## Architectural Notes

### Transient-Only Retries
By design, `withRetry` ONLY retries errors classified as `Lane.Transient`:
- Network codes (ECONNRESET, ETIMEDOUT, ECONNREFUSED, EPIPE).
- APICallError with `isRetryable=true`.

RouteWorthy errors (ProviderError, ResourceError, CircuitOpenError) are **not** retried; they throw immediately and should be handled by graceful degradation (fallback, skip, degrade) elsewhere.

### Never Wraps LLM Turns
Per spec D5, this is for **cross-boundary ops WE own** (MCP calls, HTTP probes, downloads). LLM turns have their own retry semantics in the inference layer and AI SDK and should never be wrapped in `withRetry`.

### Full-Jitter Backoff
The default jitter function `() => 0.5 + Math.random() / 2` produces uniform random [0.5, 1.0], applied to the exponential backoff to avoid thundering herd.

### Retry-After Header Support
If an error carries a `retry-after` header (common in 429/503 responses), it overrides the computed backoff:
```typescript
const delay = retryAfter ?? Math.floor(jitter() * backoff);
```

### Abort Signal Semantics
- If signal is **already aborted**, the first attempt still runs; re-attempts are skipped.
- If signal **becomes aborted** during sleep, the sleep resolves early, then re-attempts are skipped.
- This prevents blocking on abort.

## Self-Review

### Correctness
✓ All tests pass (10/10).
✓ Transient-lane-only default retryability enforced.
✓ Non-retryable errors throw immediately (not consumed from attempt count).
✓ Backoff formula matches the spec (exponential, capped, jittered).
✓ Abort signal stops re-attempts but allows first attempt.
✓ parseRetryAfter validates number finitude and non-negativity.

### Code Quality
✓ Early returns in backoff check.
✓ Clear, concise implementation.
✓ Exports properly typed (`type RetryOpts`, function signatures).
✓ Consistent with project style (enum over string literals, `type` over `interface`).
✓ No console.log, no dead code.

### Documentation
✓ JSDoc on each function (purpose, semantics, special cases).
✓ Comment on non-retryable immediate throw (prevents confusion).
✓ Comment on first-attempt-always-runs abort semantics.

### Lint & Format
✓ All imports sorted (alphabetical).
✓ Long signatures broken to multiple lines (Biome rules).
✓ No style violations.

## Concerns
None. The implementation is straightforward, well-tested, and aligns with the spec. The integration with `classify()` and `config.ts` is clean.

## Next Steps
- Task 5 (part of Slice 21) will likely integrate this into cross-boundary call sites (MCP, HTTP, downloads).
- No follow-on work needed within this task.
