import 'vitest';
import type { AxeMatchers } from 'vitest-axe/matchers';

// vitest-axe@0.1.0's own `extend-expect.d.ts` augments
// `declare global { namespace Vi { interface Assertion } }` — the matcher
// convention vitest used pre-v2. Vitest 4's `@vitest/expect`/`vitest`
// packages export their own `Assertion`/`AsymmetricMatchersContaining`
// interfaces directly (see `@testing-library/jest-dom`'s `types/vitest.d.ts`
// for the same pattern), which no longer merge with that global namespace.
// This shim re-declares the augmentation the way vitest 4 expects, so
// `expect(await axe(container)).toHaveNoViolations()` typechecks.
declare module 'vitest' {
  interface Assertion<T = unknown> extends AxeMatchers {}
  interface AsymmetricMatchersContaining extends AxeMatchers {}
}
