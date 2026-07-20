## Task 3: Daemon status/bind + queue stats DTOs

**Files:**
- Modify: `src/contracts/dto.ts` (`DaemonBindDtoSchema`, `DaemonStatusDtoSchema`, `QueueStatsDtoSchema`)
- Test: `tests/contracts/daemon-queue-dto.test.ts` (new)

**Interfaces:**
- Consumes: `JobStatusWire` (`src/contracts/enums.ts:221`).
- Produces: `DaemonBindDtoSchema`, `DaemonStatusDtoSchema`, `QueueStatsDtoSchema` (+ their `z.infer` type exports) EXACTLY as in Shared contracts.

- [ ] **Step 1: Write the failing test** — `tests/contracts/daemon-queue-dto.test.ts`:
```typescript
import { test, expect } from 'bun:test';
import {
  DaemonStatusDtoSchema,
  QueueStatsDtoSchema,
} from '../../src/contracts/dto.ts';

test('DaemonStatusDto round-trips with bind + optional uptime', () => {
  const dto = DaemonStatusDtoSchema.parse({
    running: true, pid: 42, startedAt: 1000, uptimeMs: 500,
    bind: { bind: '127.0.0.1', allowedHosts: [], port: 4130, sessionTtlMs: 1 },
  });
  expect(dto.bind.port).toBe(4130);
  expect(DaemonStatusDtoSchema.parse({
    running: false, bind: { bind: '127.0.0.1', allowedHosts: [], port: 4130, sessionTtlMs: 1 },
  }).pid).toBeUndefined();
});

test('QueueStatsDto keeps activeCount distinct from counts.running', () => {
  const dto = QueueStatsDtoSchema.parse({
    counts: { running: 2 }, total: 2, activeCount: 1, concurrency: 4,
  });
  expect(dto.activeCount).toBe(1);
  expect(dto.counts.running).toBe(2);
});
```

- [ ] **Step 2: Run — verify it fails** — `bun test tests/contracts/daemon-queue-dto.test.ts` → FAIL.

- [ ] **Step 3: Implement** — add the three schemas to `src/contracts/dto.ts` (verbatim from Shared contracts). Add `JobStatusWire` to the enums import if not present (it already is, line 9).

- [ ] **Step 4: Run — verify green** → PASS.

- [ ] **Step 5: Gate + commit**
```bash
bun run typecheck && bun run lint:file -- src/contracts/dto.ts tests/contracts/daemon-queue-dto.test.ts
git add src/contracts/dto.ts tests/contracts/daemon-queue-dto.test.ts
git commit -m "feat(contracts): DaemonStatus/DaemonBind/QueueStats DTOs (Slice 25b Incr 1)"
```

