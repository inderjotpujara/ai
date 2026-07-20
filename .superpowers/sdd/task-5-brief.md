## Task 5: Daemon logs query/response contract

**Files:**
- Modify: `src/contracts/requests.ts` (`DaemonLogsQuerySchema`, `DaemonLogsResponseSchema`)
- Test: `tests/contracts/daemon-logs.test.ts` (new)

**Interfaces:**
- Produces: `DaemonLogsQuerySchema` (coerces `tail`, caps at 2000, defaults 200; `stream` enum `['out','err']` default `'out'`) + `DaemonLogsResponseSchema` (verbatim from Shared contracts).

- [ ] **Step 1: Write the failing test** — `tests/contracts/daemon-logs.test.ts`:
```typescript
import { test, expect } from 'bun:test';
import { DaemonLogsQuerySchema } from '../../src/contracts/requests.ts';

test('DaemonLogsQuery coerces tail, applies defaults, caps at 2000', () => {
  expect(DaemonLogsQuerySchema.parse({}).tail).toBe(200);
  expect(DaemonLogsQuerySchema.parse({}).stream).toBe('out');
  expect(DaemonLogsQuerySchema.parse({ tail: '50' }).tail).toBe(50);
  expect(() => DaemonLogsQuerySchema.parse({ tail: '3000' })).toThrow();
  expect(() => DaemonLogsQuerySchema.parse({ stream: 'both' })).toThrow();
});
```

- [ ] **Step 2: Run — verify it fails** → FAIL.

- [ ] **Step 3: Implement** — add both schemas to `requests.ts` (verbatim from Shared contracts). Note the `z.enum(['out','err'])` inline literal follows the existing `EdgeDtoSchema` precedent (`dto.ts:256`) for a wire-only two-value set with no engine mirror.

- [ ] **Step 4: Run — verify green** → PASS.

- [ ] **Step 5: Gate + commit**
```bash
bun run typecheck && bun run lint:file -- src/contracts/requests.ts tests/contracts/daemon-logs.test.ts
git add src/contracts/requests.ts tests/contracts/daemon-logs.test.ts
git commit -m "feat(contracts): DaemonLogs query/response (Slice 25b Incr 1)"
```

