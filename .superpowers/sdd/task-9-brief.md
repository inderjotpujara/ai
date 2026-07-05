### Task 9: Telemetry — reliability attrs + recordDegrade

**Files:**
- Modify: `src/telemetry/spans.ts` (add ATTR keys + `recordDegrade`)
- Test: `tests/telemetry/reliability-spans.test.ts`

**Interfaces:**
- Consumes: `DegradeEvent`, `DegradeKind` from `src/reliability/ledger.ts`; existing `ATTR` object + active-span helpers.
- Produces: new `ATTR` keys `RELIABILITY_RETRY_ATTEMPTS='retry.attempts'`, `RELIABILITY_RETRY_LANE='retry.lane'`, `RELIABILITY_BREAKER_STATE='breaker.state'`, `RELIABILITY_DEGRADE_FROM='degrade.from'`, `RELIABILITY_DEGRADE_TO='degrade.to'`, `RELIABILITY_DEGRADE_REASON='degrade.reason'`, `RELIABILITY_DROPPED_AGENT='partial_failure.dropped_agent'`, `ERROR_TYPE='error.type'`; `recordDegrade(event: DegradeEvent): void` (adds a span event `'reliability.degrade'` on the active span with the standard `error.type` attribute).

- [ ] **Step 1: Write the failing test**

```ts
// tests/telemetry/reliability-spans.test.ts
import { describe, expect, it } from 'bun:test';
import { ATTR, recordDegrade } from '../../src/telemetry/spans.ts';
import { DegradeKind } from '../../src/reliability/ledger.ts';

describe('reliability telemetry', () => {
  it('exposes reliability ATTR keys', () => {
    expect(ATTR.RELIABILITY_DEGRADE_REASON).toBe('degrade.reason');
    expect(ATTR.RELIABILITY_DROPPED_AGENT).toBe('partial_failure.dropped_agent');
    expect(ATTR.ERROR_TYPE).toBe('error.type');
  });
  it('recordDegrade does not throw without an active span', () => {
    expect(() =>
      recordDegrade({ kind: DegradeKind.AgentDropped, subject: 'a', reason: 'down' }),
    ).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/telemetry/reliability-spans.test.ts`
Expected: FAIL — `ATTR.RELIABILITY_DEGRADE_REASON` undefined / `recordDegrade` not exported.

- [ ] **Step 3: Write minimal implementation**

In `src/telemetry/spans.ts`, add to the `ATTR` object (before the closing `} as const;`):

```ts
  // Reliability (Slice 21)
  RELIABILITY_RETRY_ATTEMPTS: 'retry.attempts',
  RELIABILITY_RETRY_LANE: 'retry.lane',
  RELIABILITY_BREAKER_STATE: 'breaker.state',
  RELIABILITY_DEGRADE_FROM: 'degrade.from',
  RELIABILITY_DEGRADE_TO: 'degrade.to',
  RELIABILITY_DEGRADE_REASON: 'degrade.reason',
  RELIABILITY_DROPPED_AGENT: 'partial_failure.dropped_agent',
  ERROR_TYPE: 'error.type',
```

Add the recorder (near `recordGuardrailViolation`), importing the types at the top of the file:

```ts
import type { DegradeEvent } from '../reliability/ledger.ts';
```

```ts
/** Record a degradation event on the active span (mirrors recordGuardrailViolation). */
export function recordDegrade(event: DegradeEvent): void {
  const span = trace.getActiveSpan();
  if (!span) return;
  span.addEvent('reliability.degrade', {
    [ATTR.ERROR_TYPE]: event.kind,
    'degrade.subject': event.subject,
    [ATTR.RELIABILITY_DEGRADE_REASON]: event.reason,
    ...(event.detail ? { 'degrade.detail': event.detail } : {}),
  });
}
```

(If `trace` is not already imported in the module, reuse the existing import used by `recordGuardrailViolation`/`getActiveSpan`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/telemetry/reliability-spans.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Typecheck, lint, commit**

```bash
bun run typecheck && bun run lint:file -- "src/telemetry/spans.ts" "tests/telemetry/reliability-spans.test.ts"
git add src/telemetry/spans.ts tests/telemetry/reliability-spans.test.ts
git commit -m "feat(telemetry): reliability attrs + recordDegrade"
```

---

