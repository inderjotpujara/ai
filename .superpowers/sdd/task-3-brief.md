### Task 3: CircuitOpenError

**Files:**
- Create: `src/reliability/errors.ts`
- Modify: `tests/reliability/classify.test.ts` (add a case)
- Test: `tests/reliability/errors.test.ts`

**Interfaces:**
- Consumes: `FrameworkError` (re-declared? No — import indirectly). `CircuitOpenError` must extend the same base as other framework errors. Since `FrameworkError` is not exported from `core/errors.ts`, `CircuitOpenError` extends `Error` directly and sets `this.name` (matching the pattern used by `JudgeUnavailableError`/`LiveReferenceError` in `verified-build`).
- Produces: `class CircuitOpenError extends Error` with `readonly dependencyId: string`.
- Also: `classify()` maps `CircuitOpenError` → `Lane.RouteWorthy` (open breaker = try elsewhere).

- [ ] **Step 1: Write the failing test**

```ts
// tests/reliability/errors.test.ts
import { describe, expect, it } from 'bun:test';
import { CircuitOpenError } from '../../src/reliability/errors.ts';

describe('CircuitOpenError', () => {
  it('carries the dependency id and a stable name', () => {
    const e = new CircuitOpenError('mcp:github');
    expect(e.dependencyId).toBe('mcp:github');
    expect(e.name).toBe('CircuitOpenError');
    expect(e.message).toContain('mcp:github');
    expect(e instanceof Error).toBe(true);
  });
});
```

Also append to `tests/reliability/classify.test.ts`:

```ts
// add import at top:
// import { CircuitOpenError } from '../../src/reliability/errors.ts';
// add inside describe('classify', ...):
  it('CircuitOpenError is RouteWorthy', () => {
    expect(classify(new CircuitOpenError('mcp:x'))).toBe(Lane.RouteWorthy);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/reliability/errors.test.ts`
Expected: FAIL — cannot resolve `errors.ts`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/reliability/errors.ts
/** Thrown by an open circuit breaker: the dependency is being given a rest. */
export class CircuitOpenError extends Error {
  constructor(readonly dependencyId: string) {
    super(`circuit open for dependency "${dependencyId}"`);
    this.name = 'CircuitOpenError';
  }
}
```

Then update `src/reliability/classify.ts`:

```ts
// add import:
import { CircuitOpenError } from './errors.ts';
// in classify(), before the ProviderError check:
  if (err instanceof CircuitOpenError) {
    return Lane.RouteWorthy;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/reliability/errors.test.ts tests/reliability/classify.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Typecheck, lint, commit**

```bash
bun run typecheck && bun run lint:file -- "src/reliability/errors.ts" "src/reliability/classify.ts" "tests/reliability/errors.test.ts"
git add src/reliability/errors.ts src/reliability/classify.ts tests/reliability/errors.test.ts tests/reliability/classify.test.ts
git commit -m "feat(reliability): CircuitOpenError (route-worthy)"
```

---

