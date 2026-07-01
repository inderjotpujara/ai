## Task 2: Telemetry spans (additive)

**Files:** Modify `src/telemetry/spans.ts`; Test `tests/verification/spans.test.ts`

**Interfaces:** Produces `ATTR.VERIFICATION_SUPPORTED/FAITHFULNESS/UNSUPPORTED/CRAG_GRADE/RETRIES/FALLBACK`; `withVerificationSpan(info, fn)`; `recordVerdict(v)`.

> Read `src/telemetry/spans.ts` first; mirror `withMemoryRecallSpan`/`recordGuardrailViolation` exactly (the `inSpan` primitive + `trace.getActiveSpan()` guard pattern).

- [ ] **Step 1: Failing test**
```ts
// tests/verification/spans.test.ts
import { describe, expect, test } from 'bun:test';
import { registerTestProvider } from '../helpers/otel-test-provider.ts';
import { withVerificationSpan } from '../../src/telemetry/spans.ts';

describe('verification span', () => {
  test('emits verification.check with supported + faithfulness', async () => {
    const { exporter, shutdown } = registerTestProvider();
    await withVerificationSpan({ supported: false, faithfulness: 0.5, crag: 'incorrect', retries: 1, fallback: false }, async () => 'x');
    const s = exporter.getFinishedSpans().find((sp) => sp.name === 'verification.check');
    expect(s?.attributes['verification.supported']).toBe(false);
    expect(s?.attributes['verification.faithfulness']).toBe(0.5);
    await shutdown();
  });
});
```
> Adapt the helper import/shape to the real `tests/helpers/otel-test-provider.ts` (see how `tests/**` assert memory/crew spans).

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Extend `ATTR` + add helpers** (mirror existing span helpers):
```ts
// add to ATTR:
VERIFICATION_SUPPORTED: 'verification.supported',
VERIFICATION_FAITHFULNESS: 'verification.faithfulness',
VERIFICATION_UNSUPPORTED: 'verification.unsupported_claims',
VERIFICATION_CRAG_GRADE: 'verification.crag_grade',
VERIFICATION_RETRIES: 'verification.retries',
VERIFICATION_FALLBACK: 'verification.fallback',

export function withVerificationSpan<T>(
  info: { supported?: boolean; faithfulness?: number; crag?: string; retries?: number; fallback?: boolean },
  fn: () => Promise<T>,
): Promise<T> {
  return inSpan('verification.check', async (span) => {
    if (info.supported != null) span.setAttribute(ATTR.VERIFICATION_SUPPORTED, info.supported);
    if (info.faithfulness != null) span.setAttribute(ATTR.VERIFICATION_FAITHFULNESS, info.faithfulness);
    if (info.crag) span.setAttribute(ATTR.VERIFICATION_CRAG_GRADE, info.crag);
    if (info.retries != null) span.setAttribute(ATTR.VERIFICATION_RETRIES, info.retries);
    if (info.fallback != null) span.setAttribute(ATTR.VERIFICATION_FALLBACK, info.fallback);
    return fn();
  });
}
```
- [ ] **Step 4: Run tests + full suite** — `bun test tests/verification/spans.test.ts && bun test` → PASS, no telemetry regression.
- [ ] **Step 5: Commit** — `git commit -m "feat(telemetry): verification.check span + ATTR.VERIFICATION_*"`

---

