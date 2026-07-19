## Task 11: Queue config knobs + `computeConcurrency` (hardware-derived, env-override)

**Files:**
- Modify: `src/config/schema.ts` (add a `// --- Daemon / queue (Slice 24) ---` group with `AGENT_QUEUE_CONCURRENCY`, `AGENT_QUEUE_PATH`, `AGENT_QUEUE_POLL_MS`)
- Create: `src/queue/concurrency.ts`
- Create: `tests/queue/concurrency.test.ts`

**Interfaces:**
- Consumes: `node:os` `availableParallelism`/`totalmem` (precedent `src/resource/hardware.ts:76,108`).
- Produces: `computeConcurrency(deps?: { parallelism?: () => number; totalmemBytes?: () => number; env?: string }): number` — env-override `AGENT_QUEUE_CONCURRENCY` wins when a positive integer; else computed from hardware (a fraction of cores, floored at 1, capped so heavy per-run model work never oversubscribes). NEVER a hardcoded literal N.

- [ ] **Step 1: Write the failing test**

`tests/queue/concurrency.test.ts`:
```typescript
import { test, expect } from 'bun:test';
import { computeConcurrency } from '../../src/queue/concurrency.ts';

test('env override wins when a positive integer', () => {
  expect(computeConcurrency({ env: '3', parallelism: () => 16 })).toBe(3);
});

test('a non-positive / non-numeric env is ignored', () => {
  expect(computeConcurrency({ env: '0', parallelism: () => 8 })).toBeGreaterThan(0);
  expect(computeConcurrency({ env: 'abc', parallelism: () => 8 })).toBeGreaterThan(0);
});

test('computed concurrency is derived from cores, floored at 1', () => {
  expect(computeConcurrency({ parallelism: () => 1 })).toBe(1);
  const many = computeConcurrency({ parallelism: () => 16 });
  expect(many).toBeGreaterThanOrEqual(1);
  expect(many).toBeLessThanOrEqual(16);
});
```

- [ ] **Step 2: Run — verify it fails**

`bun test tests/queue/concurrency.test.ts` → FAIL.

- [ ] **Step 3: Implement `src/queue/concurrency.ts` + config rows**

`src/queue/concurrency.ts`:
```typescript
import { availableParallelism, totalmem } from 'node:os';

/**
 * Worker-pool concurrency: how many jobs run at once. Computed from hardware —
 * NEVER hardcoded (repo rule). Each job may drive a local model, so we take a
 * conservative fraction of logical cores (half, floored at 1) and never exceed
 * the core count. `AGENT_QUEUE_CONCURRENCY` overrides when a positive integer.
 */
export function computeConcurrency(
  deps: {
    parallelism?: () => number;
    totalmemBytes?: () => number;
    env?: string;
  } = {},
): number {
  const raw = deps.env ?? process.env.AGENT_QUEUE_CONCURRENCY;
  const override = Number(raw);
  if (Number.isInteger(override) && override > 0) return override;
  const cores = (deps.parallelism ?? availableParallelism)();
  void (deps.totalmemBytes ?? totalmem); // reserved for a future RAM-aware cap
  return Math.max(1, Math.floor(cores / 2));
}
```
Add to `CONFIG_ENTRIES` in `src/config/schema.ts` (after the `AGENT_SESSIONS_PATH` group, keeping the grouped-comment style):
```typescript
  // --- Daemon / queue (Slice 24) ---
  {
    env: 'AGENT_QUEUE_CONCURRENCY',
    kind: 'number',
    def: 0,
    doc: 'Max concurrent jobs the worker pool runs (queue/pool.ts). 0/unset = computed from hardware (queue/concurrency.ts, half of logical cores, floored at 1); a positive integer overrides. Never hardcode N.',
  },
  {
    env: 'AGENT_QUEUE_PATH',
    kind: 'string',
    def: 'jobs',
    doc: 'Directory for the durable job-queue SQLite store (queue/store.ts createJobStore), mirroring AGENT_SESSIONS_PATH.',
  },
  {
    env: 'AGENT_QUEUE_POLL_MS',
    kind: 'number',
    def: 250,
    doc: 'How often an idle worker re-checks the queue for claimable jobs (queue/pool.ts). Fallback-only override.',
  },
```

- [ ] **Step 4: Run — verify it passes**

`bun test tests/queue/concurrency.test.ts` → PASS (3 tests). Then `bun run config | grep AGENT_QUEUE` shows the three new rows.

- [ ] **Step 5: Gate + commit**

```bash
bun run typecheck && bun run lint:file -- src/queue/concurrency.ts src/config/schema.ts tests/queue/concurrency.test.ts
git add src/queue/concurrency.ts src/config/schema.ts tests/queue/concurrency.test.ts
git commit -m "feat(queue): computeConcurrency + AGENT_QUEUE_* config knobs (Slice 24 Incr 2)"
```

