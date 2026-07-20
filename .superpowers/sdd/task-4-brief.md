### Task 4: Queue provenance + chain-depth columns

**Files:**
- Modify: `src/queue/types.ts:50-58` (`JobInput`), `:31-48` (`JobRecord`); `src/queue/migrations.ts` (append a migration); `src/queue/store.ts` (`JobRowRaw`, `toJobRecord`, `enqueue`)
- Test: `tests/queue/store-origin.test.ts`

**Interfaces:**
- Consumes: `RunOrigin` from `src/contracts/enums.ts`.
- Produces:
  - `JobInput` gains `origin?: RunOrigin` and `chainDepth?: number`.
  - `JobRecord` gains `origin: RunOrigin | undefined` and `chainDepth: number`.
  - `JOB_MIGRATIONS` gains a third entry `add-origin-and-chain-depth`.

- [ ] **Step 1: Write the failing test** — a job enqueued with `origin`/`chainDepth` reads them back; a default job reads `origin: undefined, chainDepth: 0`:

```ts
import { expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunOrigin } from '../../src/contracts/enums.ts';
import { createJobStore } from '../../src/queue/store.ts';
import { JobKind } from '../../src/queue/types.ts';

test('enqueue persists origin + chainDepth, defaults are undefined/0', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jobs-'));
  const store = createJobStore({ path: dir }, {});
  const a = store.enqueue({ kind: JobKind.Chat, payload: {}, origin: RunOrigin.Schedule, chainDepth: 3 });
  const b = store.enqueue({ kind: JobKind.Chat, payload: {} });
  expect(store.getJob(a.id)?.origin).toBe(RunOrigin.Schedule);
  expect(store.getJob(a.id)?.chainDepth).toBe(3);
  expect(store.getJob(b.id)?.origin).toBeUndefined();
  expect(store.getJob(b.id)?.chainDepth).toBe(0);
  store.close();
});
```

- [ ] **Step 2: Run test to verify it fails** — `bun run test -- -t "enqueue persists origin"` → FAIL (columns/fields missing).
- [ ] **Step 3: Write minimal implementation.**
  - `src/queue/migrations.ts` — append:

```ts
  {
    name: 'add-origin-and-chain-depth',
    up: (db: Database) => {
      // Slice 25: trigger-fired jobs carry provenance (RunOrigin.Schedule/
      // Webhook/Api) so the runs `?origin=` facet lights up; chain_depth is the
      // §7.3 A→B→A cycle guard — every hop increments it, fire.ts caps it.
      db.run(`ALTER TABLE jobs ADD COLUMN origin TEXT`);
      db.run(`ALTER TABLE jobs ADD COLUMN chain_depth INTEGER NOT NULL DEFAULT 0`);
    },
  },
```

  - `src/queue/types.ts` — add `origin?: RunOrigin` + `chainDepth?: number` to `JobInput`; `origin: RunOrigin | undefined` + `chainDepth: number` to `JobRecord`; `import { RunOrigin } from '../contracts/enums.ts'` at the top (one-directional; contracts imports nothing from queue).
  - `src/queue/store.ts` — add `origin: string | null` + `chain_depth: number` to `JobRowRaw`; in `toJobRecord` set `origin: (r.origin ?? undefined) as RunOrigin | undefined, chainDepth: r.chain_depth`; in `enqueue` extend the INSERT column list + values with `origin` (`input.origin ?? null`) and `chain_depth` (`input.chainDepth ?? 0`).
- [ ] **Step 4: Run test to verify it passes** → PASS.
- [ ] **Step 5: Gate + commit** — `bun run typecheck && bun run lint:file -- src/queue/types.ts src/queue/migrations.ts src/queue/store.ts tests/queue/store-origin.test.ts && bun run test -- -t "claimNext"` (regression-check the existing claim tests still pass).

```bash
git add src/queue/types.ts src/queue/migrations.ts src/queue/store.ts tests/queue/store-origin.test.ts
git commit -m "feat(queue): job origin + chain_depth columns"
```

*Model: Opus (touches the shared claim-path SQL + column ordering; a mis-ordered INSERT value list silently corrupts every job row).* Reviewer verifies the INSERT column/value lists stay aligned and the existing `JobDtoSchema` still parses (it ignores `chainDepth`; `availableAt`/`retriedFrom` unaffected).

