## Task 4: Queue types — `JobStatus` / `JobPriority` / `JobKind` enums + `JobRecord` / `JobInput`

**Files:**
- Create: `src/queue/types.ts`
- Create: `tests/queue/types.test.ts`

**Interfaces:**
- Consumes: `RunKind` (`src/contracts/enums.ts:116`) — test-only, to assert `JobKind` values are a subset.
- Produces: the **Shared contracts** `JobStatus`, `JobPriority`, `JobKind`, `JobRecord`, `JobInput` (verbatim from the top of this plan). `JobStoreDeps = Record<string, never>` (parity seam, mirroring `SessionStoreDeps` at `src/session/store.ts:102`).

- [ ] **Step 1: Write the failing test**

`tests/queue/types.test.ts`:
```typescript
import { test, expect } from 'bun:test';
import { RunKind } from '../../src/contracts/enums.ts';
import { JobKind, JobPriority, JobStatus } from '../../src/queue/types.ts';

test('JobStatus has the six lifecycle states', () => {
  expect(Object.values(JobStatus).sort()).toEqual(
    ['canceled', 'done', 'failed', 'interrupted', 'queued', 'running'].sort(),
  );
});

test('JobPriority has two lanes', () => {
  expect(Object.values(JobPriority)).toEqual(['high', 'normal']);
});

test('every JobKind value is a valid RunKind value (subset invariant)', () => {
  const runKinds = new Set<string>(Object.values(RunKind));
  for (const k of Object.values(JobKind)) {
    expect(runKinds.has(k)).toBe(true);
  }
});
```

- [ ] **Step 2: Run — verify it fails**

`bun test tests/queue/types.test.ts` → FAIL (`src/queue/types.ts` does not exist).

- [ ] **Step 3: Implement `src/queue/types.ts`**

Write the three enums + `JobRecord` + `JobInput` + `JobStoreDeps` EXACTLY as in the Shared-contracts block at the top of this plan. (Copy it verbatim; do not re-derive field names or enum values.)

- [ ] **Step 4: Run — verify it passes**

`bun test tests/queue/types.test.ts` → PASS (3 tests).

- [ ] **Step 5: Gate + commit**

```bash
bun run typecheck && bun run lint:file -- src/queue/types.ts tests/queue/types.test.ts
git add src/queue/types.ts tests/queue/types.test.ts
git commit -m "feat(queue): JobStatus/JobPriority/JobKind + JobRecord types (Slice 24 Incr 2)"
```

