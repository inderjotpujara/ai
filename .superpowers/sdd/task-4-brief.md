### Task 4: `use-reduced-motion.ts` — the `matchMedia` hook gating JS-driven motion (D3)

**Files:**
- Create: `web/src/shared/a11y/use-reduced-motion.ts`
- Create: `web/src/shared/a11y/use-reduced-motion.test.ts`

**Interfaces:**
- Consumes: `matchMedia` (global, already faked in `web/src/test/setup.ts`'s default `beforeEach` — this task's own tests override that default stub locally).
- Produces: `export function useReducedMotion(): boolean`. Consumed by `DagView` (Task 5).

- [ ] **Step 1: Write the failing test**

Create `web/src/shared/a11y/use-reduced-motion.test.ts`:

```ts
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useReducedMotion } from './use-reduced-motion.ts';

const QUERY = '(prefers-reduced-motion: reduce)';

function stubMatchMedia(initialMatches: boolean) {
  let changeListener: (() => void) | undefined;
  const mql = {
    matches: initialMatches,
    media: QUERY,
    addEventListener: vi.fn((event: string, cb: () => void) => {
      if (event === 'change') changeListener = cb;
    }),
    removeEventListener: vi.fn(),
  };
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue(mql));
  return {
    fireChange(nextMatches: boolean) {
      mql.matches = nextMatches;
      changeListener?.();
    },
  };
}

describe('useReducedMotion (D3)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads prefers-reduced-motion: true on mount', () => {
    stubMatchMedia(true);
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(true);
  });

  it('defaults to false when the OS does not request reduced motion', () => {
    stubMatchMedia(false);
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);
  });

  it('updates when the media query change event fires', () => {
    const { fireChange } = stubMatchMedia(false);
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);
    act(() => fireChange(true));
    expect(result.current).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && bun run test -- a11y/use-reduced-motion.test.ts`
Expected: FAIL — `error: Cannot find module './use-reduced-motion.ts'` (the file doesn't exist yet).

- [ ] **Step 3: Write minimal implementation**

Create `web/src/shared/a11y/use-reduced-motion.ts`:

```ts
import { useEffect, useState } from 'react';

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/**
 * True when the OS/browser requests reduced motion. `tokens.css`'s
 * `@media (prefers-reduced-motion: reduce)` rule only zeroes CSS
 * animation/transition durations — it has no effect on JS-driven motion like
 * `@xyflow/react`'s imperative `fitView` pan/zoom (D3). Consumers that drive
 * their own animation read this hook instead.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(() =>
    typeof matchMedia === 'function'
      ? matchMedia(REDUCED_MOTION_QUERY).matches
      : false,
  );

  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const mql = matchMedia(REDUCED_MOTION_QUERY);
    const onChange = () => setReduced(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return reduced;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && bun run test -- a11y/use-reduced-motion.test.ts`
Expected: PASS (3 tests).

Run: `cd web && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/shared/a11y/use-reduced-motion.ts web/src/shared/a11y/use-reduced-motion.test.ts
git commit -m "feat(a11y): matchMedia-backed useReducedMotion hook (D3)"
```

---

