### Task 2: Wire enums + parity tests

**Files:**
- Modify: `src/contracts/enums.ts` (append after `JobKindWire`)
- Test: `tests/contracts/trigger-enum-parity.test.ts`

**Interfaces:**
- Consumes: `TriggerType`/`TriggerOrigin`/`TriggerOutcome` from `src/triggers/types.ts` (test-side only — the contract file stays isomorphic and imports nothing).
- Produces: `enum TriggerTypeWire { Cron='cron', Webhook='webhook', File='file', JobChain='jobchain' }`, `enum TriggerOriginWire { Repo='repo', Console='console' }`, `enum TriggerOutcomeWire { Fired='fired', SkippedOverlap='skipped-overlap', Failed='failed' }`.

- [ ] **Step 1: Write the failing test** (mirrors `tests/contracts/job-kind-parity.test.ts`):

```ts
import { expect, test } from 'bun:test';
import {
  TriggerOriginWire,
  TriggerOutcomeWire,
  TriggerTypeWire,
} from '../../src/contracts/enums.ts';
import {
  TriggerOrigin,
  TriggerOutcome,
  TriggerType,
} from '../../src/triggers/types.ts';

const values = (e: Record<string, string>): string[] => Object.values(e).sort();

test('contract TriggerType values stay isomorphic with the engine', () => {
  expect(values(TriggerTypeWire)).toEqual(values(TriggerType));
});
test('contract TriggerOrigin values stay isomorphic with the engine', () => {
  expect(values(TriggerOriginWire)).toEqual(values(TriggerOrigin));
});
test('contract TriggerOutcome values stay isomorphic with the engine', () => {
  expect(values(TriggerOutcomeWire)).toEqual(values(TriggerOutcome));
});
```

- [ ] **Step 2: Run test to verify it fails** — `bun run test -- -t "isomorphic with the engine"` → FAIL (wire enums undefined).
- [ ] **Step 3: Write minimal implementation** — append the three wire enums to `src/contracts/enums.ts` with a doc comment referencing `src/triggers/types.ts` and this parity test (exactly the `JobKindWire` precedent).
- [ ] **Step 4: Run test to verify it passes** → PASS (all three).
- [ ] **Step 5: Gate + commit** — `bun run typecheck && bun run lint:file -- src/contracts/enums.ts tests/contracts/trigger-enum-parity.test.ts`.

```bash
git add src/contracts/enums.ts tests/contracts/trigger-enum-parity.test.ts
git commit -m "feat(contracts): trigger wire enums + parity tests"
```

*Model: Sonnet.*

