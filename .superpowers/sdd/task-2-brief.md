### Task 2: Error-lane classifier

**Files:**
- Create: `src/reliability/classify.ts`
- Test: `tests/reliability/classify.test.ts`

**Interfaces:**
- Consumes: `FrameworkError` subclasses from `src/core/errors.ts` (`ProviderError`, `ResourceError`, `ToolError`, `MaxStepsError`); `APICallError` from `ai`.
- Produces: `enum Lane { Transient, RouteWorthy, Terminal }`; `classify(err: unknown): Lane`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/reliability/classify.test.ts
import { describe, expect, it } from 'bun:test';
import { APICallError } from 'ai';
import { ProviderError, ResourceError, ToolError } from '../../src/core/errors.ts';
import { classify, Lane } from '../../src/reliability/classify.ts';

function apiError(statusCode: number, isRetryable: boolean): APICallError {
  return new APICallError({
    message: `HTTP ${statusCode}`,
    url: 'http://x',
    requestBodyValues: {},
    statusCode,
    isRetryable,
  });
}

describe('classify', () => {
  it('retryable API errors are Transient', () => {
    expect(classify(apiError(429, true))).toBe(Lane.Transient);
    expect(classify(apiError(503, true))).toBe(Lane.Transient);
  });
  it('non-retryable client API errors are Terminal', () => {
    expect(classify(apiError(400, false))).toBe(Lane.Terminal);
    expect(classify(apiError(401, false))).toBe(Lane.Terminal);
  });
  it('ProviderError and ResourceError are RouteWorthy', () => {
    expect(classify(new ProviderError('pull failed'))).toBe(Lane.RouteWorthy);
    expect(classify(new ResourceError('no fit'))).toBe(Lane.RouteWorthy);
  });
  it('ToolError is Terminal', () => {
    expect(classify(new ToolError('bad args'))).toBe(Lane.Terminal);
  });
  it('network reset codes are Transient', () => {
    const e = Object.assign(new Error('reset'), { code: 'ECONNRESET' });
    expect(classify(e)).toBe(Lane.Transient);
  });
  it('unknown errors fail safe to Terminal', () => {
    expect(classify(new Error('mystery'))).toBe(Lane.Terminal);
    expect(classify('a string')).toBe(Lane.Terminal);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/reliability/classify.test.ts`
Expected: FAIL — cannot resolve `classify.ts`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/reliability/classify.ts
import { APICallError } from 'ai';
import { ProviderError, ResourceError, ToolError } from '../core/errors.ts';

/** Three lanes drive the retry/degrade/partial-failure wiring. */
export enum Lane {
  Transient, // back off + retry (ops we own only)
  RouteWorthy, // don't backoff — degrade/fallback/skip
  Terminal, // fail fast — no retry, surface to user
}

const TRANSIENT_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EPIPE']);

/**
 * Classify an error into a reliability lane. Pure; never throws.
 * Unknown/unclassifiable → Terminal (fail safe: never silently retry the unknown).
 */
export function classify(err: unknown): Lane {
  if (APICallError.isInstance(err)) {
    return err.isRetryable ? Lane.Transient : Lane.Terminal;
  }
  if (err instanceof ProviderError || err instanceof ResourceError) {
    return Lane.RouteWorthy;
  }
  if (err instanceof ToolError) {
    return Lane.Terminal;
  }
  const code = (err as { code?: unknown })?.code;
  if (typeof code === 'string' && TRANSIENT_CODES.has(code)) {
    return Lane.Transient;
  }
  return Lane.Terminal;
}
```

Note: `APICallError.isInstance` is the AI SDK v6 guard. If typecheck reports it missing, use `APICallError.isAPICallError` — verify against the installed `ai` types before finalizing.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/reliability/classify.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Typecheck, lint, commit**

```bash
bun run typecheck && bun run lint:file -- "src/reliability/classify.ts" "tests/reliability/classify.test.ts"
git add src/reliability/classify.ts tests/reliability/classify.test.ts
git commit -m "feat(reliability): three-lane error classifier"
```

---

