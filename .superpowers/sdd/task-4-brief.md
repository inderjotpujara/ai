## Task 4: Crew telemetry span

**Files:**
- Modify: `src/telemetry/spans.ts` (extend `ATTR`; add `withCrewSpan`)
- Test: `tests/telemetry/crew-spans.test.ts`

**Interfaces:**
- Consumes: the existing private `inSpan` helper + `ATTR` object in `spans.ts` (mirror `withWorkflowSpan`).
- Produces: `ATTR.CREW_ID/CREW_PROCESS/CREW_TASK_MEMBER`; `withCrewSpan(crewId: string, process: string, fn: () => Promise<T>): Promise<T>`.

- [ ] **Step 1: Write the failing test `tests/telemetry/crew-spans.test.ts`**

```typescript
import { describe, expect, it } from 'bun:test';
import { registerTestProvider } from '../helpers/otel-test-provider.ts';
import { ATTR, withCrewSpan, withStepSpan } from '../../src/telemetry/spans.ts';

describe('crew spans', () => {
  it('opens crew.run with id + process and nests child spans under it', async () => {
    const { exporter } = registerTestProvider();
    await withCrewSpan('research-crew', 'sequential', async () => {
      await withStepSpan('t1', 'agent', async () => {});
    });
    const spans = exporter.getFinishedSpans();
    const crew = spans.find((s) => s.name === 'crew.run');
    const step = spans.find((s) => s.name === 'workflow.step');
    expect(crew?.attributes[ATTR.CREW_ID]).toBe('research-crew');
    expect(crew?.attributes[ATTR.CREW_PROCESS]).toBe('sequential');
    expect(step?.parentSpanContext?.spanId).toBe(crew?.spanContext().spanId);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/telemetry/crew-spans.test.ts`
Expected: FAIL — `withCrewSpan` not exported.

- [ ] **Step 3: Extend `src/telemetry/spans.ts`**

Add these keys to the `ATTR` object (before the closing `} as const;`):

```typescript
  CREW_ID: 'crew.id',
  CREW_PROCESS: 'crew.process',
  CREW_TASK_MEMBER: 'crew.task.member',
```

Add the helper (mirror the existing `withWorkflowSpan`, which wraps the private `inSpan`):

```typescript
/** Root span for a crew run. The nested workflow.run/workflow.step (sequential)
 *  or agent.delegation (hierarchical) spans attach beneath it via active context. */
export function withCrewSpan<T>(
  crewId: string,
  process: string,
  fn: () => Promise<T>,
): Promise<T> {
  return inSpan('crew.run', async (span) => {
    span.setAttribute(ATTR.CREW_ID, crewId);
    span.setAttribute(ATTR.CREW_PROCESS, process);
    return fn();
  });
}
```

- [ ] **Step 4: Run tests + typecheck**

Run: `bun test tests/telemetry/crew-spans.test.ts && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/telemetry/spans.ts tests/telemetry/crew-spans.test.ts
git commit -m "feat(telemetry): crew.run span + crew ATTR keys"
```

---

