### Task 8: Runtime telemetry (`RUNTIME_*` attrs + `withRuntimeSpan`)

**Files:**
- Modify: `src/telemetry/spans.ts` (ATTR keys + `withRuntimeSpan`)
- Modify: `src/runtime/managed-openai-compatible.ts` (emit spawn/warm span)
- Test: `tests/telemetry/runtime-span.test.ts`

**Interfaces:**
- Produces: `ATTR.RUNTIME_KIND='runtime.kind'`, `RUNTIME_CONTEXT_CAPABILITY='runtime.context.capability'`, `RUNTIME_CONTEXT_REQUESTED='runtime.context.requested'`, `RUNTIME_CONTEXT_APPLIED='runtime.context.applied'`, `RUNTIME_WARM_OUTCOME='runtime.warm.outcome'`. `withRuntimeSpan(kind, fn)` mirroring `withToolSpan` (span name `runtime.warm`), exposing a recorder to set capability/requested/applied/outcome.
- Behavior: `control.warm` wraps its work in `withRuntimeSpan`; sets `RUNTIME_CONTEXT_APPLIED` = numCtx for `relaunch`/`reload`, and `-1`/omitted for `fixed` (so the MLX fixed-context limitation is observable). Outcome `spawned` | `reused` | `daemon-loaded` | `failed`.

- [ ] **Step 1: failing test** — export a `withRuntimeSpan` and assert it exists + sets attributes without throwing (mirror how other span helpers are unit-tested; if the suite has a span-capture harness use it, else assert the function runs the body and returns its value).
```typescript
// tests/telemetry/runtime-span.test.ts
import { expect, test } from 'bun:test';
import { withRuntimeSpan, ATTR } from '../../src/telemetry/spans.ts';
import { RuntimeKind } from '../../src/core/types.ts';

test('withRuntimeSpan runs the body and exposes a recorder', async () => {
  const out = await withRuntimeSpan(RuntimeKind.LlamaCpp, async (rec) => { rec.applied(8192, 8192, 'spawned', 'relaunch'); return 7; });
  expect(out).toBe(7);
  expect(ATTR.RUNTIME_CONTEXT_APPLIED).toBe('runtime.context.applied');
});
```
- [ ] **Step 2: fail**.
- [ ] **Step 3: implement** the ATTR keys + `withRuntimeSpan` (mirror `withCrewBuildSpan`'s recorder shape), and wire it into `managed-openai-compatible.ts` `warm`.
- [ ] **Step 4: pass**.
- [ ] **Step 5: commit** (`feat(telemetry): runtime warm/spawn spans + RUNTIME_* attrs`).

---

