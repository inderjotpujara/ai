## Task 4: Device DTOs + pairing requests + rotate-root request

**Files:**
- Modify: `src/contracts/dto.ts` (`DeviceDtoSchema`, `DeviceListResponseSchema`)
- Modify: `src/contracts/requests.ts` (`DevicePairRequestSchema`, `DevicePairResponseSchema`, `RotateRootRequestSchema`)
- Test: `tests/contracts/device-dto.test.ts` (new)

**Interfaces:**
- Produces: `DeviceDtoSchema`/`DeviceListResponseSchema` (dto.ts) + `DevicePairRequestSchema`/`DevicePairResponseSchema`/`RotateRootRequestSchema` (requests.ts) EXACTLY as in Shared contracts.

- [ ] **Step 1: Write the failing test** — `tests/contracts/device-dto.test.ts`:
```typescript
import { test, expect } from 'bun:test';
import { DeviceListResponseSchema } from '../../src/contracts/dto.ts';
import { DevicePairRequestSchema } from '../../src/contracts/requests.ts';

test('DeviceListResponse round-trips a device row', () => {
  const r = DeviceListResponseSchema.parse({
    items: [{ deviceId: 'd1', label: 'phone', createdAt: 1, exp: 2 }],
  });
  expect(r.items[0]?.label).toBe('phone');
});
test('DevicePairRequest rejects an empty label and caps at 120 chars', () => {
  expect(() => DevicePairRequestSchema.parse({ label: '' })).toThrow();
  expect(() => DevicePairRequestSchema.parse({ label: 'x'.repeat(121) })).toThrow();
  expect(DevicePairRequestSchema.parse({ label: 'ok' }).label).toBe('ok');
});
```

- [ ] **Step 2: Run — verify it fails** → FAIL.

- [ ] **Step 3: Implement** — add `DeviceDtoSchema` + `DeviceListResponseSchema` to `dto.ts`; add `DevicePairRequestSchema` + `DevicePairResponseSchema` + `RotateRootRequestSchema` to `requests.ts` (verbatim from Shared contracts).

- [ ] **Step 4: Run — verify green** → PASS.

- [ ] **Step 5: Gate + commit**
```bash
bun run typecheck && bun run lint:file -- src/contracts/dto.ts src/contracts/requests.ts tests/contracts/device-dto.test.ts
git add src/contracts/dto.ts src/contracts/requests.ts tests/contracts/device-dto.test.ts
git commit -m "feat(contracts): Device DTOs + pair/rotate-root requests (Slice 25b Incr 1)"
```

