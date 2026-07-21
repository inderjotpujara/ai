### Task 1: Engine trigger types + enums

**Files:**
- Create: `src/triggers/types.ts`
- Test: `tests/triggers/types.test.ts`

**Interfaces:**
- Consumes: `JobKind`, `JobStatus` from `src/queue/types.ts`; `RunOrigin` from `src/contracts/enums.ts`.
- Produces:
  - `enum TriggerType { Cron='cron', Webhook='webhook', File='file', JobChain='jobchain' }`
  - `enum TriggerOrigin { Repo='repo', Console='console' }`
  - `enum TriggerOutcome { Fired='fired', SkippedOverlap='skipped-overlap', Failed='failed' }`
  - `enum FileEventKind { Add='add', Change='change' }`
  - `type CronConfig = { schedule: string; timezone?: string; catchUp?: boolean; allowOverlap?: boolean }`
  - `type WebhookConfig = { hmac?: boolean }`
  - `type FileConfig = { path: string; events?: FileEventKind[] }`
  - `type JobChainConfig = { onKind?: JobKind; onName?: string; onStatus: JobStatus }`
  - `type TriggerConfig = CronConfig | WebhookConfig | FileConfig | JobChainConfig`
  - `type TriggerTarget = { kind: JobKind; payload: unknown }`
  - `type Trigger = { id: string; name: string; type: TriggerType; enabled: boolean; target: TriggerTarget; config: TriggerConfig; origin: TriggerOrigin; nextRunAt?: number; lastFiredAt?: number; secretRef?: string; createdAt: number; updatedAt: number }`
  - `type TriggerFiring = { id: string; triggerId: string; firedAt: number; jobId?: string; runId?: string; outcome: TriggerOutcome }`
  - `type TriggerInput = { name: string; type: TriggerType; enabled?: boolean; target: TriggerTarget; config: TriggerConfig; origin: TriggerOrigin; secretRef?: string; nextRunAt?: number }`

- [ ] **Step 1: Write the failing test** — assert the enum string values are exactly the spec's wire strings (so a later rename breaks loudly).

```ts
import { expect, test } from 'bun:test';
import { TriggerOrigin, TriggerOutcome, TriggerType } from '../../src/triggers/types.ts';

test('TriggerType holds the four source wire values', () => {
  expect(Object.values(TriggerType).sort()).toEqual(
    ['cron', 'file', 'jobchain', 'webhook'],
  );
});
test('TriggerOrigin + TriggerOutcome wire values', () => {
  expect(Object.values(TriggerOrigin).sort()).toEqual(['console', 'repo']);
  expect(Object.values(TriggerOutcome).sort()).toEqual(
    ['failed', 'fired', 'skipped-overlap'],
  );
});
```

- [ ] **Step 2: Run test to verify it fails** — `bun run test -- -t "TriggerType holds"` → FAIL (module not found).
- [ ] **Step 3: Write minimal implementation** — create `src/triggers/types.ts` with the enums and `type`s from the Produces block above. `import { type JobKind, type JobStatus } from '../queue/types.ts'` and `import type { RunOrigin } from '../contracts/enums.ts'` (RunOrigin is only re-referenced in later modules; import lazily where used — types.ts itself needs only JobKind/JobStatus).
- [ ] **Step 4: Run test to verify it passes** — `bun run test -- -t "TriggerType holds"` → PASS.
- [ ] **Step 5: Land the `src/triggers/` docs stub in THIS commit (unblocks `docs:check`).** Creating the first `src/triggers/` file makes `scripts/docs-check.ts` fail on the pre-commit hook (it hard-fails on any undocumented top-level `src/<subsystem>`, and `.githooks/pre-commit` has no bypass). Insert a minimal stub section into `docs/architecture.md` — placed near the Queue/Daemon subsystem sections — so the `arch.includes('src/triggers')` substring check passes from this first commit. 2–4 sentences, marked as expanded later:

```markdown
### `src/triggers/` — trigger engine (Slice 25, stub)

A durable poll-tick trigger engine that lives in the daemon: four sources —
cron, webhook, file-watch, and job-chain — converge on `fire.ts`, which
enqueues a target `JobKind`+payload via `JobStore.enqueue` (threading `origin`
provenance) and writes a `trigger_firings` audit row. Triggers are authored
from repo TS defs (`triggers/index.ts`, `origin=repo`) and console/API CRUD
(`origin=console`), persisted in `jobs.db`.

> Stub — expanded into the full subsystem writeup (module map, data-flow
> edges, `/hooks/:token` route class) in this slice's docs task (Task 34).
```

- [ ] **Step 6: Gate + commit** — `bun run typecheck && bun run lint:file -- src/triggers/types.ts tests/triggers/types.test.ts && bun run docs:check` (docs-check now PASSES because the stub documents `src/triggers/`).

```bash
git add src/triggers/types.ts tests/triggers/types.test.ts docs/architecture.md
git commit -m "feat(triggers): engine trigger types + enums (+ src/triggers docs stub)"
```

*Model: Sonnet (mechanical type definition + a one-paragraph docs stub).*

