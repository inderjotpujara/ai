# Slice 25 — Scheduled + Triggered Agents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the trigger *backend* — cron, webhook, file-watch, and job-chain triggers that enqueue a target `JobKind`+payload onto the existing Slice-24 queue — plus its API, live console tab, and CLI, threading `origin` provenance so trigger-fired runs are filterable.

**Architecture:** A durable **poll-tick scheduler** lives in the daemon (`src/triggers/`), constructed beside the pool and lifecycle-bound to it (started AFTER pool+server, stopped FIRST). Four sources (cron via Croner, webhook via a new `POST /hooks/:token` route outside the `/api` guard, file via chokidar v4, job-chain via a pool completion observer) all converge on one `fire.ts` that enqueues onto `jobs.db` and writes a `trigger_firings` audit row. Triggers are authored from two surfaces — repo TS defs (the `crews/` pattern, `origin=repo`, pause/resume-only from the console) and console/API CRUD (`origin=console`, full CRUD) — persisted in the existing queue DB.

**Tech Stack:** Bun + TypeScript, `bun:sqlite`, Zod v4 contracts, React 19 web console (`apiFetch`, no query lib), OpenTelemetry spans. New deps: `croner` (v10, cron next-time computation) and `chokidar@4` (file watching), both runtime.

## Global Constraints

- **bun only, never npm.** Per-task gate = `bun run typecheck` AND `bun run lint:file -- <files>` AND focused `bun run test -- -t "<name>"` — all three (bun test type-checks nothing; pre-commit is docs:check only). Web tasks gate = `cd web && bun run typecheck && bun run test`.
- **Full `bun run check`** (docs-check · typecheck · lint · check:web · test) at each increment boundary-gate task. Don't merge red.
- **TDD every task:** write the failing test first, watch it fail, implement minimally, watch it pass, commit. Implementers run FOCUSED tests inline + commit per task (conventional format `type(scope): summary`, ending with the `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` trailer). The controller runs the full suite between tasks.
- **Repo style:** prefer `type` over `interface`; **string enums over literal unions** for finite named sets (`enum Foo { A = 'A' }`); discriminated object unions stay `type` with an enum discriminant; early returns over nested conditionals; small focused files; **no `console.log`** (use `src/log/logger.ts` or the injected `print`).
- **Never hardcode model choices / budgets / limits.** New tunables go through `src/config/schema.ts` (`CONFIG_SPEC`); defaults are computed or conventional; env vars are fallback-only.
- **New deps** (`croner`, `chokidar@4`) are added via `bun add <pkg>` **in the task that first needs them**, never speculatively.
- **Provider/runtime-agnostic:** triggers target existing `JobKind`s only and enqueue through the same `JobStore.enqueue` every launch path uses — no per-runtime branching.
- **Security is not negotiable on the hard parts (§7.1–7.4):** constant-time token compare, HMAC over the RAW body, replay window, body cap, rate limit, path confinement, chain-cycle cap, and **plain string interpolation — never `eval`/`Function`/a template engine** for `{{…}}` substitution. Secrets never appear in logs, DTOs, or spans.
- **Docs hard line (all four surfaces, same push, or the pre-push slice-landing gate blocks):** `docs/architecture.md`, root `README.md` (Status line + slice table row + feature paragraph), `docs/ROADMAP.md` (flip the markers), and the SDD ledger `.superpowers/sdd/progress.md`. Regenerate the interactive architecture-snapshot Artifact (tooling can only remind).

## Standing notes (carried by every task; audited by the final review against the diff)

**Architecture-doc update.** Add a new **`src/triggers/` subsystem** to `docs/architecture.md` (scheduler tick → `fire.ts` convergence → `JobStore.enqueue`; the four sources; the boot sync) with data-flow edges into the Queue/Daemon sections; document the new **`/hooks/:token` route class** outside the `/api` guard but inside the perimeter; document `origin` threading through `dispatch.ts` and the new `triggers`/`trigger_firings` tables in `jobs.db`. **`scripts/docs-check.ts` hard-fails on any undocumented top-level `src/<subsystem>`, and `.githooks/pre-commit` runs it with NO bypass — so the VERY FIRST `src/triggers/` file (Task 1) would block its own commit.** To avoid that, Task 1 lands a minimal `src/triggers/` STUB section in `docs/architecture.md` in the same commit (so the substring check passes from the first commit on); Task 34 EXPANDS that stub into the full subsystem writeup. Consequently `bun run docs:check` passes throughout the slice — no boundary-gate needs a docs-check exemption.

**Telemetry to emit.** New spans via the existing `inSpan`/`ATTR` conventions (`src/telemetry/spans.ts`; no parallel emission path, no-op without a tracer): `trigger.register`, `trigger.fire`, `trigger.skip`, carrying new `ATTR` keys `TRIGGER_ID`, `TRIGGER_TYPE`, `TRIGGER_ORIGIN`, `TRIGGER_OUTCOME`. The `/api/triggers*` + `/hooks/:token` request spans nest under `withServerRequestSpan` like every other route.

---

## File Structure (decomposition lock-in)

**New engine modules (`src/triggers/`):**
- `types.ts` — `TriggerType`/`TriggerOrigin`/`TriggerOutcome` enums; per-type config `type`s; `Trigger`, `TriggerFiring`, `TriggerInput`.
- `migrations.ts` — `TRIGGER_MIGRATIONS` (the `triggers` + `trigger_firings` tables). Runs as `[...JOB_MIGRATIONS, ...TRIGGER_MIGRATIONS]` (see Task 5's critical note on `user_version`).
- `store.ts` — `createTriggerStore` (CRUD, atomic `claimDueCron`, enabled-overlay upsert, firings keyset list, `latestFiring`).
- `spans.ts` — `recordTriggerRegister` / `withTriggerFireSpan` / `recordTriggerSkip`.
- `substitute.ts` — `substituteTemplate(payload, vars)` (plain recursive string interpolation, §7.3).
- `next-run.ts` — `computeNextRun(trigger, after)` (Croner wrapper) + `validateCron`.
- `fire.ts` — `createFireTrigger` (single convergence: overlap check, chain-depth cap, enqueue+origin+chainDepth, firing row, span).
- `scheduler.ts` — `createScheduler` (poll tick + boot `reconcile` misfire policy).
- `watcher.ts` — `createFileWatcher` (chokidar4, path confinement, `{{file.path}}`).
- `chain.ts` — `createChainObserver` (`handleJobSettled` matcher + depth threading).
- `sync.ts` — `syncRepoTriggers` (boot upsert/prune of `triggers/index.ts` defs).
- `secret-store.ts` — `createTriggerSecretStore` (`~/.agent/trigger-secrets.json`, `0600`).
- `engine.ts` — `createTriggersEngine` (wires store+secret+fire+scheduler+watcher+chain; `start()`/`stop()`).

**New repo authoring surface:**
- `triggers/index.ts` — registry (`crews/index.ts` pattern; `TRIGGER-BUILDER:IMPORTS`/`:ENTRIES` markers reserved).

**New server routes:**
- `src/server/triggers/{list,detail,create,patch,delete,firings,fire}.ts` — the seven `/api/triggers*` handlers.
- `src/server/hooks/webhook.ts` — `POST /hooks/:token`.

**New CLI:**
- `src/cli/triggers.ts` — `agent triggers list|add|enable|disable|remove|history|fire`.

**New web (`web/src/features/ops/`):**
- `use-triggers.ts`, `use-trigger-firings.ts` — hooks.
- `trigger-create-dialog.tsx`, `trigger-firings-drawer.tsx` — components.
- `triggers-tab.tsx` — replace the static stub with the live list (keep `data-testid="ops-triggers"`).

**Modified files:**
- `src/contracts/enums.ts` — `TriggerTypeWire`/`TriggerOriginWire`/`TriggerOutcomeWire`.
- `src/contracts/dto.ts` — `TriggerDtoSchema`, `TriggerFiringDtoSchema`.
- `src/contracts/requests.ts` — create/patch/list/firing-list/fire request+response schemas + per-type config schemas.
- `src/queue/types.ts` — `origin?: RunOrigin` + `chainDepth?: number` on `JobInput`/`JobRecord`.
- `src/queue/migrations.ts` — one migration adding `origin` + `chain_depth` columns to `jobs`.
- `src/queue/store.ts` — thread `origin`/`chainDepth` through `enqueue` + `toJobRecord` + `JobRowRaw`.
- `src/queue/pool.ts` — `onSettled?` callback in `createWorkerPool` opts (the chain seam).
- `src/server/jobs/dispatch.ts` — generalize `markDaemonOrigin` → origin-aware.
- `src/server/app.ts` — the `/hooks/:token` branch (outside the `/api` guard) + the seven `/api/triggers*` routes.
- `src/server/main.ts` + `src/cli/daemon.ts` + `src/daemon/core.ts` — construct + lifecycle-bind the triggers engine.
- `src/telemetry/spans.ts` — the four `TRIGGER_*` `ATTR` keys.
- `src/config/schema.ts` — `AGENT_TRIGGERS_POLL_MS`, `AGENT_TRIGGERS_MAX_CHAIN_DEPTH`, `AGENT_TRIGGERS_WATCH_ROOT`, `AGENT_TRIGGERS_ENABLED`.
- `package.json` — the `triggers` script.

---

## Increment 1 — Contracts + storage foundation

Establishes the type spine (engine enums/types, wire mirrors, DTOs, request schemas) and the durable storage (the two trigger tables + the `jobs` provenance/chain columns). No behavior yet — but every later task's signatures are fixed here.

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

### Task 3: Trigger DTOs + request/response schemas

**Files:**
- Modify: `src/contracts/dto.ts` (append after `JobDtoSchema`), `src/contracts/requests.ts` (append at end)
- Test: `tests/contracts/trigger-dto.test.ts`

**Interfaces:**
- Consumes: `TriggerTypeWire`, `TriggerOriginWire`, `TriggerOutcomeWire`, `JobKindWire`, `JobStatusWire` from `./enums.ts`; `JobLaunchResponseSchema` reused for fire responses (`{ jobId, runId }`).
- Produces (dto.ts):
  - `TriggerDtoSchema` / `TriggerDTO`: `{ id, name, type: z.enum(TriggerTypeWire), enabled: z.boolean(), target: z.object({ kind: z.enum(JobKindWire), payload: z.unknown() }), config: z.unknown(), origin: z.enum(TriggerOriginWire), nextRunAt: z.number().optional(), lastFiredAt: z.number().optional(), createdAt: z.number(), updatedAt: z.number(), webhookUrl: z.string().optional() }` — **NEVER** a token/secret field.
  - `TriggerFiringDtoSchema` / `TriggerFiringDTO`: `{ id, triggerId, firedAt: z.number(), jobId: z.string().optional(), runId: z.string().optional(), outcome: z.enum(TriggerOutcomeWire) }`.
- Produces (requests.ts):
  - Per-type config schemas: `CronConfigSchema` (`{ schedule: z.string().min(1).max(200), timezone: z.string().max(64).optional(), catchUp: z.boolean().optional(), allowOverlap: z.boolean().optional() }`), `WebhookConfigSchema` (`{ hmac: z.boolean().optional() }`), `FileConfigSchema` (`{ path: z.string().min(1).max(4096), events: z.array(z.enum(['add','change'])).optional() }`), `JobChainConfigSchema` (`{ onKind: z.enum(JobKindWire).optional(), onName: z.string().max(200).optional(), onStatus: z.enum(['done','failed']) }`).
  - `TriggerCreateRequestSchema` / `TriggerCreateRequest`: `{ name: z.string().min(1).max(120), type: z.enum(TriggerTypeWire), target: z.object({ kind: z.enum(JobKindWire), payload: z.unknown() }), config: z.unknown(), enabled: z.boolean().optional() }` (config validated per-type in the handler, Task 23).
  - `TriggerPatchRequestSchema` / `TriggerPatchRequest`: `{ enabled: z.boolean().optional(), target: z.object({ kind: z.enum(JobKindWire), payload: z.unknown() }).optional(), config: z.unknown().optional() }`.
  - `TriggerCreateResponseSchema` / `TriggerCreateResponse`: `{ trigger: TriggerDtoSchema, webhookToken: z.string().optional(), webhookUrl: z.string().optional() }` — the raw path token is transmitted EXACTLY ONCE here (the `DevicePairResponseSchema` precedent).
  - `TriggerListResponseSchema` / `TriggerListResponse`: `{ items: z.array(TriggerDtoSchema) }` (plain array — small set, no cursor, the `CrewListResponseSchema` idiom).
  - `TriggerFiringListQuerySchema` / `TriggerFiringListQuery`: `{ cursor: z.string().optional(), limit: z.coerce.number().int().positive().max(200).default(25) }`.
  - `TriggerFiringListResponseSchema` / `TriggerFiringListResponse`: `{ items: z.array(TriggerFiringDtoSchema), nextCursor: z.string().optional(), total: z.number() }` (keyset — `JobListResponseSchema` shape).

- [ ] **Step 1: Write the failing test** — round-trip a `TriggerDtoSchema` value and reject a bad `outcome`:

```ts
import { expect, test } from 'bun:test';
import {
  TriggerDtoSchema,
  TriggerFiringDtoSchema,
} from '../../src/contracts/dto.ts';

test('TriggerDtoSchema round-trips a cron trigger', () => {
  const dto = {
    id: 't-1', name: 'nightly', type: 'cron', enabled: true,
    target: { kind: 'workflow', payload: { input: 'x' } },
    config: { schedule: '0 3 * * *' }, origin: 'console',
    nextRunAt: 1, createdAt: 1, updatedAt: 1,
  };
  expect(TriggerDtoSchema.parse(dto)).toMatchObject({ id: 't-1', type: 'cron' });
});
test('TriggerFiringDtoSchema rejects an unknown outcome', () => {
  expect(() =>
    TriggerFiringDtoSchema.parse({
      id: 'f1', triggerId: 't-1', firedAt: 1, outcome: 'exploded',
    }),
  ).toThrow();
});
```

- [ ] **Step 2: Run test to verify it fails** — `bun run test -- -t "TriggerDtoSchema round-trips"` → FAIL.
- [ ] **Step 3: Write minimal implementation** — add the schemas from the Produces block to `dto.ts` and `requests.ts`. Import the new wire enums; reuse `JobLaunchResponseSchema` where the plan later needs a `{ jobId, runId }` fire response (no new schema for that).
- [ ] **Step 4: Run test to verify it passes** → PASS.
- [ ] **Step 5: Gate + commit** — `bun run typecheck && bun run lint:file -- src/contracts/dto.ts src/contracts/requests.ts tests/contracts/trigger-dto.test.ts`.

```bash
git add src/contracts/dto.ts src/contracts/requests.ts tests/contracts/trigger-dto.test.ts
git commit -m "feat(contracts): trigger DTOs + request/response schemas"
```

*Model: Sonnet.*

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

### Task 5: Trigger tables migration

**Files:**
- Create: `src/triggers/migrations.ts`
- Test: `tests/triggers/migrations.test.ts`

**Interfaces:**
- Consumes: `JOB_MIGRATIONS` from `src/queue/migrations.ts`; `migrate`, `Migration` from `src/db/migrate.ts`.
- Produces: `export const TRIGGER_MIGRATIONS: Migration[]` (two entries) and `export const JOBS_DB_MIGRATIONS: Migration[] = [...JOB_MIGRATIONS, ...TRIGGER_MIGRATIONS]`.

> **CRITICAL — why the combined list (do not skip this).** `migrate()` tracks progress with a single `PRAGMA user_version` **per database**, not a per-migration tracking table. `jobs.db` is opened by BOTH `createJobStore` (which runs `JOB_MIGRATIONS`, advancing `user_version` to 3) and, in this slice, `createTriggerStore`. If the trigger store called `migrate(db, TRIGGER_MIGRATIONS)` it would read `user_version = 3`, conclude both its migrations are already applied, and **silently create no tables**. The trigger store MUST run the SUPERSET `JOBS_DB_MIGRATIONS` (`JOB_MIGRATIONS` first, then `TRIGGER_MIGRATIONS`) so `migrate` applies only the not-yet-applied tail regardless of which store opened the DB first. `JOB_MIGRATIONS` stays the authoritative jobs list; `createJobStore` is NOT changed.

- [ ] **Step 1: Write the failing test** — running `JOBS_DB_MIGRATIONS` creates both tables and is idempotent when `JOB_MIGRATIONS` already ran:

```ts
import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { migrate } from '../../src/db/migrate.ts';
import { JOB_MIGRATIONS } from '../../src/queue/migrations.ts';
import { JOBS_DB_MIGRATIONS } from '../../src/triggers/migrations.ts';

test('trigger tables land even after JOB_MIGRATIONS already advanced user_version', () => {
  const db = new Database(':memory:');
  migrate(db, JOB_MIGRATIONS); // simulate the job store opening first
  migrate(db, JOBS_DB_MIGRATIONS); // the trigger store's superset run
  const tables = db
    .query(`SELECT name FROM sqlite_master WHERE type='table'`)
    .all()
    .map((r) => (r as { name: string }).name);
  expect(tables).toContain('triggers');
  expect(tables).toContain('trigger_firings');
});
```

- [ ] **Step 2: Run test to verify it fails** → FAIL (module missing).
- [ ] **Step 3: Write minimal implementation** — `src/triggers/migrations.ts`:

```ts
import type { Database } from 'bun:sqlite';
import type { Migration } from '../db/migrate.ts';
import { JOB_MIGRATIONS } from '../queue/migrations.ts';

export const TRIGGER_MIGRATIONS: Migration[] = [
  {
    name: 'init-triggers',
    up: (db: Database) => {
      db.run(`CREATE TABLE IF NOT EXISTS triggers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        target_kind TEXT NOT NULL,
        target_payload TEXT NOT NULL,
        config TEXT NOT NULL,
        origin TEXT NOT NULL,
        next_run_at INTEGER,
        last_fired_at INTEGER,
        token_hash TEXT,
        secret_ref TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(name, origin)
      )`);
      // Due-cron claim scan (scheduler.claimDueCron): enabled + type='cron' +
      // next_run_at<=now. token_hash index backs the constant-time webhook
      // lookup (/hooks/:token).
      db.run(`CREATE INDEX IF NOT EXISTS idx_triggers_due
              ON triggers(enabled, type, next_run_at)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_triggers_token
              ON triggers(token_hash)`);
    },
  },
  {
    name: 'init-trigger-firings',
    up: (db: Database) => {
      db.run(`CREATE TABLE IF NOT EXISTS trigger_firings (
        id TEXT PRIMARY KEY,
        trigger_id TEXT NOT NULL,
        fired_at INTEGER NOT NULL,
        job_id TEXT,
        run_id TEXT,
        outcome TEXT NOT NULL
      )`);
      // Keyset firings list (GET /api/triggers/:id/firings): newest-first per trigger.
      db.run(`CREATE INDEX IF NOT EXISTS idx_firings_list
              ON trigger_firings(trigger_id, fired_at)`);
    },
  },
];

/** The AUTHORITATIVE ordered migration set for `jobs.db` when the trigger store
 *  opens it — the queue's own migrations FIRST, then the trigger tables. Run
 *  this (never a bare `migrate(db, TRIGGER_MIGRATIONS)`) so the single
 *  `PRAGMA user_version` counter stays consistent no matter which store opened
 *  the DB first (see this file's header note). */
export const JOBS_DB_MIGRATIONS: Migration[] = [
  ...JOB_MIGRATIONS,
  ...TRIGGER_MIGRATIONS,
];
```

- [ ] **Step 4: Run test to verify it passes** → PASS.
- [ ] **Step 5: Gate + commit** — `bun run typecheck && bun run lint:file -- src/triggers/migrations.ts tests/triggers/migrations.test.ts`.

```bash
git add src/triggers/migrations.ts tests/triggers/migrations.test.ts
git commit -m "feat(triggers): trigger + trigger_firings tables (combined jobs.db migration list)"
```

*Model: Opus (the `user_version` interaction is the single most silent-failure-prone decision in the slice; reviewer confirms the superset ordering and that `createJobStore` is untouched).*

### Task 6: Increment 1 boundary gate

- [ ] **Step 1: Run the full gate** — `bun run check` (docs-check · typecheck · lint · check:web · test). It runs FULLY GREEN, including docs-check: the Task-1 `src/triggers/` stub already satisfies the subsystem-documented check (no exemption needed at any gate this slice).
- [ ] **Step 2: Record the increment in the SDD ledger** (`.superpowers/sdd/progress.md`) with per-task commit refs.

*Model: controller (no code).*

---

## Increment 2 — Trigger store + scheduler core (HARD §7.2)

The scheduler-atomicity core. Ends with a working cron scheduler that fires due triggers **at-most-once per due time** (never double-fires; a crash between the claim-commit and the enqueue drops that one occurrence — an accepted, documented trade), survives restart (fire-once misfire), and skips overlapping fires — all under a fake clock, no real time.

### Task 7: Trigger store — CRUD + atomic claimDueCron + firings

**Files:**
- Create: `src/triggers/store.ts`
- Test: `tests/triggers/store.test.ts`

**Interfaces:**
- Consumes: `JOBS_DB_MIGRATIONS` from `./migrations.ts`; `migrate` from `../db/migrate.ts`; all trigger `type`s/enums from `./types.ts`.
- Produces `createTriggerStore(config: { path?: string }): TriggerStore` where:

```ts
export type TriggerStore = {
  create(input: TriggerInput, extra?: { tokenHash?: string }): Trigger;
  get(id: string): Trigger | undefined;
  getByName(name: string, origin: TriggerOrigin): Trigger | undefined;
  getByTokenHash(tokenHash: string): Trigger | undefined;
  list(): Trigger[];
  listByOrigin(origin: TriggerOrigin): Trigger[];
  update(id: string, patch: Partial<Pick<Trigger,
    'enabled' | 'target' | 'config' | 'nextRunAt' | 'lastFiredAt'>>): Trigger | undefined;
  remove(id: string): void;
  /** BEGIN IMMEDIATE claim: select due cron rows AND advance their next_run_at
   *  in ONE transaction, so no tick (or racing caller) re-claims the same row. */
  claimDueCron(now: number, computeNext: (t: Trigger) => number | null): Trigger[];
  recordFiring(firing: Omit<TriggerFiring, 'id'>): TriggerFiring;
  listFirings(triggerId: string, q: { cursor?: string; limit: number }):
    { items: TriggerFiring[]; nextCursor?: string; total: number };
  latestFiring(triggerId: string): TriggerFiring | undefined;
  /** Repo sync: upsert by (name, origin=repo) PRESERVING enabled + id +
   *  next_run_at when the row already exists (the console pause/resume overlay
   *  survives re-sync). */
  upsertRepo(input: TriggerInput): Trigger;
  /** Delete repo rows whose name is NOT in keepNames (prune removed defs). */
  pruneRepo(keepNames: string[]): void;
  close(): void;
};
```

- [ ] **Step 1: Write the failing tests** — cover CRUD, the atomic claim, and enabled-overlay survival:

```ts
import { expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JobKind } from '../../src/queue/types.ts';
import { createTriggerStore } from '../../src/triggers/store.ts';
import { TriggerOrigin, TriggerOutcome, TriggerType } from '../../src/triggers/types.ts';

const cronInput = (name: string, next: number) => ({
  name, type: TriggerType.Cron, origin: TriggerOrigin.Console,
  target: { kind: JobKind.Chat, payload: { task: 'x' } },
  config: { schedule: '* * * * *' }, nextRunAt: next, enabled: true,
});

test('claimDueCron advances next_run_at in one transaction (no double-claim)', () => {
  const store = createTriggerStore({ path: mkdtempSync(join(tmpdir(), 'trg-')) });
  const t = store.create(cronInput('due', 100));
  // First claim at now=150 returns the due row and advances it to 9999.
  const first = store.claimDueCron(150, () => 9999);
  expect(first.map((x) => x.id)).toEqual([t.id]);
  // Second claim at the SAME now returns nothing — next_run_at already moved.
  expect(store.claimDueCron(150, () => 9999)).toEqual([]);
  expect(store.get(t.id)?.nextRunAt).toBe(9999);
  // M5: the claim advances next_run_at only — last_fired_at is left untouched
  // (it is set by fire.ts on an actual Fired outcome, not by the claim).
  expect(store.get(t.id)?.lastFiredAt).toBeUndefined();
  store.close();
});

test('upsertRepo preserves the console-set enabled overlay across re-sync', () => {
  const store = createTriggerStore({ path: mkdtempSync(join(tmpdir(), 'trg-')) });
  const repo = { ...cronInput('nightly', 100), origin: TriggerOrigin.Repo };
  const created = store.upsertRepo(repo);
  store.update(created.id, { enabled: false }); // operator pauses it
  const again = store.upsertRepo({ ...repo, config: { schedule: '0 4 * * *' } });
  expect(again.id).toBe(created.id);         // same row
  expect(again.enabled).toBe(false);          // overlay survived
  expect((again.config as { schedule: string }).schedule).toBe('0 4 * * *'); // def updated
  store.close();
});

test('firings keyset list is newest-first and paginates', () => {
  const store = createTriggerStore({ path: mkdtempSync(join(tmpdir(), 'trg-')) });
  const t = store.create(cronInput('f', 100));
  for (let i = 1; i <= 3; i++) {
    store.recordFiring({ triggerId: t.id, firedAt: i, jobId: `j${i}`, runId: `r${i}`, outcome: TriggerOutcome.Fired });
  }
  const page = store.listFirings(t.id, { limit: 2 });
  expect(page.items.map((f) => f.firedAt)).toEqual([3, 2]);
  expect(page.total).toBe(3);
  expect(store.latestFiring(t.id)?.firedAt).toBe(3);
  store.close();
});
```

- [ ] **Step 2: Run tests to verify they fail** — `bun run test -- -t "claimDueCron advances"` → FAIL.
- [ ] **Step 3: Write minimal implementation.** Open the DB exactly as `createJobStore` does (WAL, busy_timeout, foreign_keys), then `migrate(db, JOBS_DB_MIGRATIONS)`. Mirror `store.ts`'s `JobRowRaw`/`toJobRecord`/cursor helpers. The claim is the hard part — copy this body verbatim:

```ts
function claimDueCron(
  now: number,
  computeNext: (t: Trigger) => number | null,
): Trigger[] {
  // BEGIN IMMEDIATE (.immediate()) takes the write lock at BEGIN — same idiom
  // as JobStore.claimNext (src/queue/store.ts:174). Selecting the due rows and
  // advancing their next_run_at happen in ONE critical section, so a second
  // tick (or a racing caller) can never read the same row as still-due: by the
  // time it runs, next_run_at is already the NEXT future occurrence. Combined
  // with the daemon's double-start pid guard (daemon/core.ts:101), this is the
  // two-lock defense against double-fire (§7.2). bun:sqlite is synchronous, so
  // the transaction body is yield-free.
  const claim = db.transaction((): Trigger[] => {
    const rows = db
      .query(
        `SELECT * FROM triggers
         WHERE enabled = 1 AND type = 'cron'
           AND next_run_at IS NOT NULL AND next_run_at <= ?
         ORDER BY next_run_at ASC, id ASC`,
      )
      .all(now) as TriggerRowRaw[];
    const claimed = rows.map(toTrigger);
    const at = now;
    for (const t of claimed) {
      // computeNext is injected (scheduler owns Croner) but CALLED INSIDE the
      // transaction so the advance is atomic with the select. A null next
      // (unparseable cron — should never reach here) parks the row by nulling
      // next_run_at so it stops being claimed rather than looping every tick.
      // M5: the claim advances next_run_at ONLY — it does NOT touch
      // last_fired_at. "Last fired" means an actual Fired outcome, which is
      // recorded by fire.ts (`update(id, { lastFiredAt })`) AFTER the enqueue
      // succeeds; a claim that then skips (overlap) or fails (chain cap) must
      // NOT report a last-fired time.
      const next = computeNext(t);
      db.run(
        `UPDATE triggers SET next_run_at = ?, updated_at = ?
         WHERE id = ?`,
        [next, at, t.id],
      );
    }
    return claimed;
  });
  return claim.immediate();
}
```

  Implement `upsertRepo` by `getByName(name, Repo)`: if found, `UPDATE` type/target/config/secret_ref/updated_at but **not** enabled/id/next_run_at; else `create({...input})`. `create` mints `id = trig-<base36 ms>-<base36 rand>` (mirror `newJobId`), serializes `target.payload`/`config` to JSON TEXT, writes `enabled` as `input.enabled === false ? 0 : 1`, stores `extra?.tokenHash` into `token_hash`. `recordFiring` mints `f-<...>` ids. `listFirings` uses the `(firedAt, id)` keyset descending (mirror `encodeJobCursor`/`decodeJobCursor` but on `fired_at`).
- [ ] **Step 4: Run tests to verify they pass** → PASS (all three).
- [ ] **Step 5: Gate + commit** — `bun run typecheck && bun run lint:file -- src/triggers/store.ts tests/triggers/store.test.ts && bun run test -- -t "claimDueCron"`.

```bash
git add src/triggers/store.ts tests/triggers/store.test.ts
git commit -m "feat(triggers): trigger store with atomic claimDueCron + enabled overlay"
```

> **NOTE — delivery semantics: at-most-once per due time (not exactly-once).** The claim advances `next_run_at` and commits BEFORE `fire.ts` enqueues the job (the enqueue happens in a SEPARATE transaction, and — see Task 9's NOTE — even on a different DB connection). If the daemon crashes in the window between the claim-commit and the enqueue, that one due occurrence is silently dropped: the row's `next_run_at` has already moved forward, so no later tick re-claims it. This is the deliberate trade — the two-lock design (BEGIN IMMEDIATE claim + the daemon double-start pid guard) guarantees **we never DOUBLE-fire**, at the cost of possibly dropping one occurrence across a crash. A true exactly-once design (a two-phase claim: mark `claimed`, enqueue, then commit `fired`, with boot-time recovery of orphaned `claimed` rows) was considered and **rejected for this slice** — it adds a recovery state machine and a second write per fire for a failure window that only opens on a hard crash mid-fire; missing-a-tick on a crash is acceptable for scheduled agents, double-firing is not. Revisit if a stronger guarantee is ever required.

*Model: **Opus implementer + adversarial verify** (HARD §7.2). The reviewer specifically probes: (a) is the select+advance genuinely one `.immediate()` transaction (no read-then-write gap)? (b) does `upsertRepo` truly never clobber `enabled`? (c) is the keyset cursor stable under equal `fired_at`?*

### Task 8: Config knobs + telemetry keys + trigger spans

**Files:**
- Modify: `src/config/schema.ts` (append a "Triggers (Slice 25)" group), `src/telemetry/spans.ts` (`ATTR`)
- Create: `src/triggers/spans.ts`
- Test: `tests/triggers/spans.test.ts`, `tests/config/trigger-knobs.test.ts`

**Interfaces:**
- Consumes: `ATTR`, `inSpan` from `../telemetry/spans.ts`; `trace` from `@opentelemetry/api`; `Trigger`, `TriggerOutcome` from `./types.ts`.
- Produces:
  - `CONFIG_SPEC` entries (each `doc` names its read site, per the no-hardcode rule):
    - `AGENT_TRIGGERS_POLL_MS` (number, def `1000`) — scheduler tick cadence (`scheduler.ts`).
    - `AGENT_TRIGGERS_MAX_CHAIN_DEPTH` (number, def `8`) — §7.3 chain-cycle cap (`fire.ts`).
    - `AGENT_TRIGGERS_WATCH_ROOT` (string, def `'~/.agent/inbox'`) — documented as "the file-watch confinement root; the leading `~` is expanded against the live home dir at the watcher read site (`watcher.ts`/`confine.ts`), the dir is created `0700` on first watcher start, and every file-trigger path is confined under it (§7.4)".
    - `AGENT_TRIGGERS_ENABLED` (boolean, def `false`) — documented as "governs ONLY whether a **standalone** `startWebServer` (no injected daemon queue) auto-constructs and starts its own triggers engine. Defaults OFF so an existing/ad-hoc `startWebServer()` (as every current server test calls it) never spins a scheduler, watches files, or leaves an open handle — the I3 invariant. The **daemon** always constructs+injects its engine explicitly (via `opts.triggers`, ignoring this flag), so the real deployment runs triggers unconditionally; the flag is the standalone-server opt-in (`AGENT_TRIGGERS_ENABLED=1`)." **(No `AGENT_TRIGGERS_PATH` knob — the repo registry is the compile-time `triggers/index.ts` import, so a path override would have no consumer.)**
  - `ATTR` keys: `TRIGGER_ID: 'trigger.id'`, `TRIGGER_TYPE: 'trigger.type'`, `TRIGGER_ORIGIN: 'trigger.origin'`, `TRIGGER_OUTCOME: 'trigger.outcome'`.
  - `src/triggers/spans.ts`: `recordTriggerRegister(t: Trigger): void`, `withTriggerFireSpan<T>(t: Trigger, fn: (rec: { outcome: (o: TriggerOutcome) => void }) => Promise<T>): Promise<T>`, `recordTriggerSkip(t: Trigger, outcome: TriggerOutcome): void`.

- [ ] **Step 1: Write the failing tests** — knobs load with the documented defaults; a fire span sets `TRIGGER_OUTCOME` via the recorder (assert against an in-memory span exporter using the repo's existing test tracer harness, or minimally that the helpers run without a tracer as a no-op):

```ts
import { expect, test } from 'bun:test';
import { loadConfig } from '../../src/config/schema.ts';
test('trigger knobs carry computed/conventional defaults', () => {
  const { values } = loadConfig({});
  expect(values.AGENT_TRIGGERS_POLL_MS).toBe(1000);
  expect(values.AGENT_TRIGGERS_MAX_CHAIN_DEPTH).toBe(8);
  expect(values.AGENT_TRIGGERS_WATCH_ROOT).toBe('~/.agent/inbox');
  expect(values.AGENT_TRIGGERS_ENABLED).toBe(false);
});
```

```ts
import { expect, test } from 'bun:test';
import { JobKind } from '../../src/queue/types.ts';
import { recordTriggerRegister, withTriggerFireSpan } from '../../src/triggers/spans.ts';
import { TriggerOrigin, TriggerOutcome, TriggerType } from '../../src/triggers/types.ts';
const t = { id: 't1', name: 'n', type: TriggerType.Cron, enabled: true,
  target: { kind: JobKind.Chat, payload: {} }, config: { schedule: '* * * * *' },
  origin: TriggerOrigin.Console, createdAt: 0, updatedAt: 0 };
test('trigger span helpers are a no-op without a tracer', async () => {
  recordTriggerRegister(t); // must not throw
  const out = await withTriggerFireSpan(t, async (rec) => { rec.outcome(TriggerOutcome.Fired); return 42; });
  expect(out).toBe(42);
});
```

- [ ] **Step 2: Run tests to verify they fail** → FAIL.
- [ ] **Step 3: Write minimal implementation** — add the four `CONFIG_SPEC` entries (each with a `doc` referencing the read site, per the no-hardcode rule); add the four `ATTR` keys near the Slice-24 daemon block; write `src/triggers/spans.ts` mirroring `src/daemon/spans.ts` exactly (`const tracer = () => trace.getTracer('agent')`, `inSpan('trigger.fire', ...)` for the fire span, `startSpan('trigger.register'|'trigger.skip')` for the one-shots). Set `TRIGGER_ID`/`TYPE`/`ORIGIN` on all three; `withTriggerFireSpan` exposes `rec.outcome` that sets `TRIGGER_OUTCOME`; `recordTriggerSkip` sets `TRIGGER_OUTCOME` from its arg.
- [ ] **Step 4: Run tests to verify they pass** → PASS.
- [ ] **Step 5: Gate + commit** — `bun run typecheck && bun run lint:file -- src/config/schema.ts src/telemetry/spans.ts src/triggers/spans.ts tests/triggers/spans.test.ts tests/config/trigger-knobs.test.ts`.

```bash
git add src/config/schema.ts src/telemetry/spans.ts src/triggers/spans.ts tests/triggers/spans.test.ts tests/config/trigger-knobs.test.ts
git commit -m "feat(triggers): config knobs + telemetry ATTR keys + trigger spans"
```

*Model: Sonnet.*

### Task 9: fire.ts — the single convergence point

**Files:**
- Create: `src/triggers/fire.ts`, `src/triggers/substitute.ts`
- Test: `tests/triggers/fire.test.ts`, `tests/triggers/substitute.test.ts`

**Interfaces:**
- Consumes: `TriggerStore` (Task 7); `JobStore`, `JobStatus`, `JobKind` from `src/queue/`; `RunOrigin` from contracts; `createRun` from `src/run/run-store.ts`; `newRunId` from `src/run/run-id.ts`; `withTriggerFireSpan`/`recordTriggerSkip` (Task 8); `substituteTemplate` (this task).
- Produces:
  - `src/triggers/substitute.ts`: `substituteTemplate(payload: unknown, vars: Record<string, string>): unknown` — deep recursive walk; in every STRING it replaces `{{key}}` (matching `/\{\{\s*([\w.]+)\s*\}\}/g`) with `vars[key]` when present, leaving unknown keys literal. **No `eval`, no `Function`, no template engine** (§7.3). Non-string leaves pass through untouched.
  - `src/triggers/fire.ts`:

```ts
export type FireReason = 'cron' | 'webhook' | 'file' | 'chain' | 'manual';
export type FireContext = {
  reason: FireReason;
  vars?: Record<string, string>;
  chainDepth?: number;   // depth of the job ABOUT to be created (chain hops)
  bypassOverlap?: boolean; // manual test-fire ignores overlap protection
};
export type FireResult =
  | { fired: true; jobId: string; runId: string }
  | { fired: false; outcome: TriggerOutcome };
export type FireTrigger = (t: Trigger, ctx: FireContext) => Promise<FireResult>;
export function createFireTrigger(deps: {
  triggerStore: TriggerStore;
  jobStore: JobStore;
  runsRoot: string;
  maxChainDepth: () => number;
}): FireTrigger;
```

- [ ] **Step 1: Write the failing tests.** Substitution:

```ts
import { expect, test } from 'bun:test';
import { substituteTemplate } from '../../src/triggers/substitute.ts';
test('substitutes {{file.path}} in nested string values only', () => {
  const out = substituteTemplate(
    { task: 'process {{file.path}}', n: 3, nested: { p: '{{file.path}}' } },
    { 'file.path': '/data/x.csv' },
  );
  expect(out).toEqual({ task: 'process /data/x.csv', n: 3, nested: { p: '/data/x.csv' } });
});
test('unknown placeholders are left literal (never evaluated)', () => {
  expect(substituteTemplate({ a: '{{secret}}' }, {})).toEqual({ a: '{{secret}}' });
});
```

  Fire (fake stores):

```ts
// A due cron fire enqueues with origin=Schedule, records a Fired firing, returns ids.
test('cron fire enqueues origin=schedule + records a Fired firing', async () => { /* ... */ });
// overlap: latest firing's job still Running + !allowOverlap → SkippedOverlap, no enqueue.
test('overlap skip when the previous job is still running', async () => { /* ... */ });
// chain-depth cap: ctx.chainDepth > maxChainDepth() → Failed, no enqueue.
test('chain-depth cap halts a runaway chain', async () => { /* ... */ });
```

- [ ] **Step 2: Run tests to verify they fail** → FAIL.
- [ ] **Step 3: Write minimal implementation.** `substitute.ts` first. Then `fire.ts` — the whole body (this is the §7.3 convergence; write it in full):

```ts
const ORIGIN_FOR: Record<FireReason, RunOrigin> = {
  cron: RunOrigin.Schedule,
  webhook: RunOrigin.Webhook,
  file: RunOrigin.Api,
  chain: RunOrigin.Api,
  manual: RunOrigin.Api,
};

export function createFireTrigger(deps: {
  triggerStore: TriggerStore; jobStore: JobStore;
  runsRoot: string; maxChainDepth: () => number;
}): FireTrigger {
  return (t, ctx) =>
    withTriggerFireSpan(t, async (rec) => {
      const now = Date.now();
      // §7.3 chain-cycle guard: the depth of the job about to be created. A
      // chain fire passes ctx.chainDepth = finishedJob.chainDepth + 1; the cap
      // is enforced HERE (the single convergence point) so no source can bypass it.
      const depth = ctx.chainDepth ?? 0;
      if (depth > deps.maxChainDepth()) {
        deps.triggerStore.recordFiring({ triggerId: t.id, firedAt: now, outcome: TriggerOutcome.Failed });
        rec.outcome(TriggerOutcome.Failed);
        return { fired: false, outcome: TriggerOutcome.Failed };
      }
      // Overlap protection: skip if the previous fired job is still in flight,
      // unless the trigger allows overlap or this is a manual test-fire.
      const allowOverlap =
        ctx.bypassOverlap === true ||
        (t.type === TriggerType.Cron && (t.config as CronConfig).allowOverlap === true);
      if (!allowOverlap) {
        const last = deps.triggerStore.latestFiring(t.id);
        if (last?.jobId) {
          const prev = deps.jobStore.getJob(last.jobId);
          if (prev && (prev.status === JobStatus.Queued || prev.status === JobStatus.Running)) {
            deps.triggerStore.recordFiring({ triggerId: t.id, firedAt: now, outcome: TriggerOutcome.SkippedOverlap });
            recordTriggerSkip(t, TriggerOutcome.SkippedOverlap);
            rec.outcome(TriggerOutcome.SkippedOverlap);
            return { fired: false, outcome: TriggerOutcome.SkippedOverlap };
          }
        }
      }
      // Pre-mint + pre-create the run dir so an immediate /api/runs/:id/stream
      // never 404s (mirrors handleJobEnqueue). dispatch's markJobOrigin will
      // also write the origin marker at execution time.
      const runId = newRunId();
      await createRun(deps.runsRoot, runId);
      const job = deps.jobStore.enqueue({
        kind: t.target.kind,
        payload: substituteTemplate(t.target.payload, ctx.vars ?? {}),
        origin: ORIGIN_FOR[ctx.reason],
        chainDepth: depth,
        runId,
      });
      deps.triggerStore.recordFiring({
        triggerId: t.id, firedAt: now, jobId: job.id, runId, outcome: TriggerOutcome.Fired,
      });
      deps.triggerStore.update(t.id, { lastFiredAt: now });
      rec.outcome(TriggerOutcome.Fired);
      return { fired: true, jobId: job.id, runId };
    });
}
```

> **NOTE (M7) — the firing-audit row and the job enqueue span two connections.** `deps.jobStore.enqueue(...)` writes through the JobStore's connection and `deps.triggerStore.recordFiring(...)` through the TriggerStore's — two separate `bun:sqlite` handles onto the same `jobs.db`, not one transaction. A crash in the sliver between them can leave a job enqueued with no matching `trigger_firings` row (or, on the skip/fail paths, a firing row with no job). This is an **audit-only gap** — the job itself is durable and runs normally; only the firing-history/console record may be missing one entry. Accepted for this slice (unifying the two writes into a single transaction would couple the two stores' connection management for a cosmetic audit record); documented rather than fixed.

- [ ] **Step 4: Run tests to verify they pass** → PASS.
- [ ] **Step 5: Gate + commit** — `bun run typecheck && bun run lint:file -- src/triggers/fire.ts src/triggers/substitute.ts tests/triggers/fire.test.ts tests/triggers/substitute.test.ts`.

```bash
git add src/triggers/fire.ts src/triggers/substitute.ts tests/triggers/fire.test.ts tests/triggers/substitute.test.ts
git commit -m "feat(triggers): fire convergence (origin/chain-depth/overlap) + template substitution"
```

*Model: **Opus implementer + adversarial verify** (HARD §7.2/§7.3). Reviewer probes: is the chain cap truly unbypassable by any `reason`? Is `substituteTemplate` provably non-`eval` (grep the diff for `Function`/`eval`/`new Function`)? Does a skip still write an audit firing?*

### Task 10: scheduler.ts — poll tick + Croner + misfire policy

**Files:**
- Create: `src/triggers/scheduler.ts`, `src/triggers/next-run.ts`
- Test: `tests/triggers/scheduler.test.ts`, `tests/triggers/next-run.test.ts`
- Dep: `bun add croner`

**Interfaces:**
- Consumes: `Cron` from `croner`; `TriggerStore`, `FireTrigger` (Task 9), `Trigger`, `CronConfig`, `TriggerType` from the triggers modules.
- Produces:
  - `src/triggers/next-run.ts`:
    - `validateCron(schedule: string, timezone?: string): boolean` — `try { new Cron(schedule, { timezone }); return true; } catch { return false; }`.
    - `computeNextRun(t: Trigger, after: number): number | null` — MUST NOT throw on a malformed pattern (an invalid repo/console cron must never crash the boot reconcile or a tick). Wrap the Croner call in try/catch and return `null` on any throw:

```ts
export function computeNextRun(t: Trigger, after: number): number | null {
  const cfg = t.config as CronConfig;
  try {
    return (
      new Cron(cfg.schedule, { timezone: cfg.timezone })
        .nextRun(new Date(after))
        ?.getTime() ?? null
    );
  } catch {
    // Malformed cron (bad pattern / bad timezone): return null rather than
    // throw. A null result parks the row (claimDueCron nulls next_run_at;
    // reconcile disables the trigger) — the daemon never crashes on a bad def.
    return null;
  }
}
```
  - `src/triggers/scheduler.ts`: `createScheduler(deps: { triggerStore: TriggerStore; fire: FireTrigger; pollMs: number; now?: () => number; setInterval?: typeof setInterval; clearInterval?: typeof clearInterval }): { start(): void; stop(): void; tick(now?: number): void; reconcile(now?: number): void }`.

- [ ] **Step 1: Write the failing tests** (fake clock — inject `now` + a manual `tick`, never real timers):

```ts
// tick fires a due cron at most once, then advances next_run_at to the future.
test('tick fires a due cron at-most-once per due time', () => { /* claimDueCron via computeNextRun; assert fire called once */ });
// misfire fire-once-on-boot: a past next_run_at + catchUp!==false → one catch-up on the first tick.
test('reconcile leaves a missed catchUp trigger due for exactly one boot fire', () => { /* ... */ });
// catchUp:false → reconcile skips the missed occurrence (advances to future, no fire on first tick).
test('reconcile with catchUp:false skips the missed fire', () => { /* ... */ });
// DST/next-time correctness via Croner.
test('computeNextRun respects an IANA timezone', () => {
  const t = { config: { schedule: '0 3 * * *', timezone: 'America/New_York' } } as any;
  expect(typeof computeNextRun(t, Date.parse('2026-03-08T00:00:00Z'))).toBe('number');
});
// I1: a malformed cron pattern returns null instead of throwing.
test('computeNextRun returns null for an unparseable cron (never throws)', () => {
  const t = { config: { schedule: 'not a cron' } } as any;
  expect(computeNextRun(t, Date.now())).toBeNull();
});
// I1: daemon-boot reconcile survives a bad repo cron — it disables the row, no throw.
test('reconcile disables (never throws on) a trigger whose cron is unparseable', () => {
  // store with one enabled cron trigger, config.schedule = 'not a cron', nextRunAt null.
  // scheduler.reconcile() must NOT throw; afterwards the row is enabled === false.
});
```

- [ ] **Step 2: Run tests to verify they fail** → FAIL.
- [ ] **Step 3: Write minimal implementation.**
  - `next-run.ts` as specified.
  - `scheduler.ts`:
    - `tick(now = deps.now())`: `const due = triggerStore.claimDueCron(now, (t) => computeNextRun(t, now)); for (const t of due) void deps.fire(t, { reason: 'cron' });` (fire is async; fire-and-forget, errors are handled inside fire).
    - `reconcile(now = deps.now())`: for every cron trigger (`triggerStore.list().filter(type===Cron)`), first compute `const next = computeNextRun(t, now)`. **If `next == null` (unparseable pattern), disable the row (`update(id, { enabled: false })`) and continue — a bad def never throws out of reconcile and never loops a tick (I1).** Otherwise: if `nextRunAt == null` → `update(id, { nextRunAt: next })`. Else if `nextRunAt < now` (missed while down): if `(config as CronConfig).catchUp === false` → advance without firing (`update(id, { nextRunAt: next })`); else LEAVE it (the first `tick` claims it, fires once, then advances — exactly one catch-up). Document this reasoning inline.
    - `start()`: `reconcile()` then `this._interval = (deps.setInterval ?? setInterval)(() => tick(), pollMs)`. `stop()`: `(deps.clearInterval ?? clearInterval)(this._interval)`.
- [ ] **Step 4: Run tests to verify they pass** → PASS.
- [ ] **Step 5: Gate + commit** — `bun run typecheck && bun run lint:file -- src/triggers/scheduler.ts src/triggers/next-run.ts tests/triggers/scheduler.test.ts tests/triggers/next-run.test.ts`.

```bash
git add src/triggers/scheduler.ts src/triggers/next-run.ts tests/triggers/scheduler.test.ts tests/triggers/next-run.test.ts package.json bun.lock
git commit -m "feat(triggers): poll-tick scheduler + Croner next-run + fire-once misfire"
```

*Model: **Opus implementer + adversarial verify** (HARD §7.2). Reviewer probes the misfire matrix: new trigger, past-due+catchUp, past-due+catchUp:false, future — exactly ONE catch-up fire on boot in each (not one per missed interval); and that `start()` calls `reconcile()` BEFORE the first tick.*

### Task 11: Increment 2 boundary gate

- [ ] **Step 1: Run the full gate** — `bun run check`. Fully green including docs-check (Task-1 stub keeps `src/triggers/` documented; no exemption).
- [ ] **Step 2: Update the SDD ledger** with Increment 2's task commits + the HARD-task review verdicts.

*Model: controller.*

---

## Increment 3 — Sources (file + chain + repo sync) + daemon wiring

Adds the two remaining event sources and the boot repo-def sync, then constructs the whole engine and lifecycle-binds it to the daemon (start AFTER pool+server, stop FIRST).

### Task 12: watcher.ts — file triggers (HARD §7.4)

**Files:**
- Create: `src/triggers/watcher.ts`, `src/triggers/confine.ts`
- Test: `tests/triggers/watcher.test.ts`, `tests/triggers/confine.test.ts`
- Dep: `bun add chokidar@4`

**Interfaces:**
- Consumes: `chokidar` (default import); `FireTrigger` (Task 9); `TriggerStore`; `FileConfig`, `TriggerType` from `./types.ts`; `loadConfig` for `AGENT_TRIGGERS_WATCH_ROOT`.
- Produces:
  - `src/triggers/confine.ts`:
    - `expandHome(p: string): string` — expands a leading `~` (bare or `~/…`) against `os.homedir()`: `p.replace(/^~(?=$|\/)/, homedir())`; any other string passes through. The default `AGENT_TRIGGERS_WATCH_ROOT` (`~/.agent/inbox`) is stored with a literal `~` (schema.ts, I4) and expanded HERE at the read site, mirroring the `~/…` config-default convention (`AGENT_MEDIA_VENV` et al.). This is the ONLY place `~` is resolved, so a literal `~` never reaches `realpathSync`.
    - `confineWatchPath(candidate: string, baseDir: string): string` — resolve `candidate` (via `realpathSync` when it exists, else `resolve`), REJECT (throw `WatchPathError`) if the resolved path is the filesystem root, is not under `realpathSync(baseDir)`, or escapes via symlink; return the confined absolute path. Mirrors `confineToDir` in `src/server/security/media-path.ts`. (Callers pass an ALREADY-`expandHome`d `baseDir`.)
  - `src/triggers/watcher.ts`: `createFileWatcher(deps: { triggerStore: TriggerStore; fire: FireTrigger; watchRoot: string; watch?: typeof chokidar.watch }): { start(): void; stop(): Promise<void> }`. On `start()` it FIRST resolves `const root = expandHome(deps.watchRoot)` and ensures the dir exists (`mkdirSync(root, { recursive: true, mode: 0o700 })` — created private on first watcher start, I4) BEFORE confining any trigger path under `root`.

- [ ] **Step 1: Write the failing tests.** Confinement (pure, no chokidar):

```ts
import { expect, test } from 'bun:test';
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { confineWatchPath, expandHome, WatchPathError } from '../../src/triggers/confine.ts';
// realpathSync the base so the assertions hold on macOS (tmpdir is a /var → /private/var symlink).
const realBase = () => realpathSync(mkdtempSync(join(tmpdir(), 'wr-')));
test('rejects the filesystem root', () => {
  expect(() => confineWatchPath('/', realBase())).toThrow(WatchPathError);
});
test('rejects a path outside the watch root', () => {
  expect(() => confineWatchPath('/etc/passwd', realBase())).toThrow(WatchPathError);
});
test('accepts a path under the watch root (real, confined dir)', () => {
  const base = realBase();
  writeFileSync(join(base, 'x.csv'), '');
  expect(confineWatchPath(join(base, 'x.csv'), base)).toBe(join(base, 'x.csv'));
});
// I4: expandHome resolves the leading ~ against the real home; a literal ~
// never survives to reach realpathSync/confineWatchPath.
test('expandHome resolves the default watch root against home', () => {
  expect(expandHome('~/.agent/inbox')).toBe(join(homedir(), '.agent/inbox'));
  expect(expandHome('/abs/path')).toBe('/abs/path'); // non-~ passes through
});
```

  Watcher (inject a fake `watch` returning a stub emitter so no real fs events fire):

```ts
test('an add event fires the matching file trigger with {{file.path}} in vars', async () => {
  // fake chokidar.watch → emitter; simulate .emit('add', '/Users/me/inbox/x.csv');
  // assert deps.fire called with { reason: 'file', vars: { 'file.path': '/Users/me/inbox/x.csv' } }
});
```

- [ ] **Step 2: Run tests to verify they fail** → FAIL.
- [ ] **Step 3: Write minimal implementation.**
  - `confine.ts` per the Produces spec (`expandHome` + `confineWatchPath` + `WatchPathError`).
  - `watcher.ts`: on `start()`, FIRST `const root = expandHome(deps.watchRoot)` then `mkdirSync(root, { recursive: true, mode: 0o700 })` (create the confinement root private on first start, I4 — so the default `~/.agent/inbox` exists and `realpathSync(root)` in `confineWatchPath` succeeds). Then gather all enabled `TriggerType.File` triggers; for each, `confineWatchPath((config as FileConfig).path, root)` (re-check at watch time even though create-time also confined — defense in depth, §7.4), then `chokidar.watch(confinedPath, { awaitWriteFinish: { stabilityThreshold: 400, pollInterval: 100 }, ignoreInitial: true, depth: 0 })`. On the configured events (default `['add']`), call `deps.fire(trigger, { reason: 'file', vars: { 'file.path': matchedPath } })`. Keep one watcher per trigger in a map; `stop()` awaits `.close()` on all. A trigger whose path fails confinement is skipped with a logged warning (never crashes `start()`).
- [ ] **Step 4: Run tests to verify they pass** → PASS.
- [ ] **Step 5: Gate + commit** — `bun run typecheck && bun run lint:file -- src/triggers/watcher.ts src/triggers/confine.ts tests/triggers/watcher.test.ts tests/triggers/confine.test.ts`.

```bash
git add src/triggers/watcher.ts src/triggers/confine.ts tests/triggers/watcher.test.ts tests/triggers/confine.test.ts package.json bun.lock
git commit -m "feat(triggers): file watcher (chokidar4) with path confinement"
```

*Model: **Opus implementer + adversarial verify** (HARD §7.4). Reviewer probes: symlink escape (a link under `baseDir` pointing to `/etc`), `..` traversal, and that confinement runs at BOTH create-time and watch-time.*

### Task 13: chain.ts — pool completion observer + depth threading (HARD §7.3)

**Files:**
- Create: `src/triggers/chain.ts`
- Modify: `src/queue/pool.ts` (add the `onSettled` seam)
- Test: `tests/triggers/chain.test.ts`, `tests/queue/pool-onsettled.test.ts`

**Interfaces:**
- Consumes: `TriggerStore`, `FireTrigger`; `JobRecord`, `JobStatus`, `JobKind` from `src/queue/`; `JobChainConfig`, `TriggerType` from `./types.ts`.
- Produces:
  - `src/queue/pool.ts`: `createWorkerPool` opts gains `onSettled?: (job: JobRecord, status: JobStatus.Done | JobStatus.Failed) => void`. Called AFTER a TERMINAL transition only — NOT on a retry re-queue, cancel, or interrupt. Wrapped so a throwing observer never breaks `runOne`/the claim loop.
  - `src/triggers/chain.ts`: `createChainObserver(deps: { triggerStore: TriggerStore; fire: FireTrigger; maxChainDepth: () => number }): { handleJobSettled: (job: JobRecord, status: JobStatus.Done | JobStatus.Failed) => void }`.

- [ ] **Step 1: Write the failing tests.** Pool seam:

```ts
// onSettled fires with Done on markDone; with Failed only on a TERMINAL failure
// (maxAttempts reached), NOT on a retry re-queue.
test('onSettled(Done) fires once on successful completion', async () => { /* ... */ });
test('onSettled is NOT called when markFailed re-queues for retry', async () => { /* ... */ });
// I5: a throwing markDone (persistence failure, swallowed) must NOT fire onSettled —
// no phantom chain off a completion that never committed.
test('onSettled is NOT called when markDone throws', async () => {
  // store whose markDone throws; run a job to success; assert onSettled spy never called
  // and runOne does not reject (the throw is swallowed).
});
```

  Chain matcher:

```ts
// job A (kind=crew, done) matches a jobchain trigger {onKind:crew,onStatus:done} → fire B
// with chainDepth = A.chainDepth + 1.
test('a matching completion fires the chained trigger with depth+1', () => { /* ... */ });
// depth cap: when A.chainDepth+1 > max, the observer still calls fire (fire.ts enforces the cap
// and records Failed) — assert fire was called with chainDepth = max+1.
test('depth threading passes the incremented depth to fire (cap enforced downstream)', () => { /* ... */ });
```

- [ ] **Step 2: Run tests to verify they fail** → FAIL.
- [ ] **Step 3: Write minimal implementation.**
  - `pool.ts`: in `runOne`, success path — call `safeSettled(job, JobStatus.Done)` **INSIDE the existing `try` block, on the line immediately AFTER `opts.store.markDone(...)` succeeds** (I5). It must NOT sit after the try/catch: `markDone` can throw (SQLITE_BUSY/FULL, DB closed mid-shutdown) and that catch swallows it leaving the row Running — firing a chained job off a completion that never actually committed would be a phantom fire. Inside the `try`, a throwing `markDone` skips `safeSettled` entirely. Corrected success path:

```ts
      if (controller.signal.aborted) return;
      try {
        opts.store.markDone(job.id, result);
        // I5: chain-observe ONLY a completion that actually committed. A throwing
        // markDone falls to the catch below (row left Running, reconciled later)
        // WITHOUT calling onSettled — no phantom chain fire off an uncommitted done.
        safeSettled(job, JobStatus.Done);
      } catch {
        // Persistence failure: swallow (degrade, never crash the claim loop);
        // row reconciled to Interrupted later. onSettled NOT called.
      }
```

  Fail path — after `markFailed` + the existing `after = getJob(...)` re-read, if `after?.status === JobStatus.Failed` call `safeSettled(after, JobStatus.Failed)` (terminal only; the existing retry branch already records `job.retry`; keep this inside the try so a throwing `markFailed`/`getJob` also skips it). `safeSettled` wraps `opts.onSettled?.(...)` in try/catch (never let an observer throw into the loop). Do NOT call it from `markCanceled`/`markInterrupted`.
  - `chain.ts`: `handleJobSettled(job, status)` → for each enabled `TriggerType.JobChain` trigger, match `(config as JobChainConfig)`: `onStatus === status` AND (`!onKind || onKind === job.kind`) AND (`!onName || onName === <job payload name>`). On a match, `deps.fire(trigger, { reason: 'chain', chainDepth: (job.chainDepth ?? 0) + 1, vars: { 'chain.jobId': job.id, 'chain.runId': job.runId ?? '' } })`. The cap is enforced in fire.ts (Task 9) — the observer always increments and delegates.
- [ ] **Step 4: Run tests to verify they pass** → PASS.
- [ ] **Step 5: Gate + commit** — `bun run typecheck && bun run lint:file -- src/queue/pool.ts src/triggers/chain.ts tests/triggers/chain.test.ts tests/queue/pool-onsettled.test.ts && bun run test -- -t "onSettled"`.

```bash
git add src/queue/pool.ts src/triggers/chain.ts tests/triggers/chain.test.ts tests/queue/pool-onsettled.test.ts
git commit -m "feat(triggers): job-chain observer + pool onSettled seam (terminal-only)"
```

*Model: **Opus implementer + adversarial verify** (HARD §7.3). Reviewer probes: the observer is TERMINAL-only (no fire on retry/cancel/interrupt), a throwing observer cannot wedge the claim loop, and A→B→A is capped by depth in fire.ts.*

### Task 14: sync.ts + repo triggers/ registry

**Files:**
- Create: `triggers/index.ts` (repo root), `src/triggers/sync.ts`
- Test: `tests/triggers/sync.test.ts`

**Interfaces:**
- Consumes: `TriggerStore`, `TriggerInput`, `TriggerOrigin`, `TriggerType`, `CronConfig`; `validateCron` from `./next-run.ts`; `logger` from `../log/logger.ts`; the repo registry.
- Produces:
  - `triggers/index.ts`: `export const TRIGGERS: Record<string, TriggerDef> = { /* TRIGGER-BUILDER:ENTRIES */ }` with `// TRIGGER-BUILDER:IMPORTS` above it, and `export function getTrigger(name: string): TriggerDef | undefined` using the `Object.hasOwn` guard — byte-for-byte the `crews/index.ts` pattern. `TriggerDef` is `Omit<TriggerInput, 'origin'>` (a repo def never sets origin; sync stamps `Repo`). Ship it EMPTY (no starter def) with only the reserved markers.
  - `src/triggers/sync.ts`: `syncRepoTriggers(store: TriggerStore, defs: Record<string, TriggerDef>): void` — for each `[name, def]`: **validate a cron def before registering (I1(b))** — if `def.type === TriggerType.Cron` and `!validateCron((def.config as CronConfig).schedule, (def.config as CronConfig).timezone)`, upsert it but force it disabled (`store.upsertRepo({ ...def, origin: TriggerOrigin.Repo, enabled: false })`) and `logger.warn('trigger.sync.invalid-cron', { name })` — the bad def is registered-but-disabled (so the operator sees it in the console) and can never crash the scheduler. A valid def: `store.upsertRepo({ ...def, origin: TriggerOrigin.Repo })`. Then `store.pruneRepo(Object.keys(defs))`.

- [ ] **Step 1: Write the failing tests:**

```ts
test('sync upserts repo defs and prunes removed ones', () => {
  // store with one existing repo row 'old' (paused) + a defs map {'nightly': ...}
  // after sync: 'nightly' exists as repo, 'old' pruned, 'nightly' enabled default true
});
// I1(b): a repo cron def with a bad pattern is registered DISABLED, never throws.
test('sync registers a bad-cron repo def as disabled (no throw)', () => {
  // defs map {'broken': { type: cron, config: { schedule: 'not a cron' }, ... }}
  // after sync: getByName('broken', Repo) exists AND enabled === false
});
```

- [ ] **Step 2: Run tests to verify they fail** → FAIL.
- [ ] **Step 3: Write minimal implementation** — `triggers/index.ts` (crews pattern, empty registry + markers) and `sync.ts` per the spec (with the cron-validation branch).
- [ ] **Step 4: Run test to verify it passes** → PASS.
- [ ] **Step 5: Gate + commit** — `bun run typecheck && bun run lint:file -- triggers/index.ts src/triggers/sync.ts tests/triggers/sync.test.ts && bun run docs:check` (a new top-level `triggers/` dir must not trip the docs check — it checks `src/<subsystem>`, but confirm).

```bash
git add triggers/index.ts src/triggers/sync.ts tests/triggers/sync.test.ts
git commit -m "feat(triggers): repo trigger registry + boot sync (upsert/prune)"
```

*Model: Sonnet.*

### Task 15: engine.ts — wire the whole subsystem

**Files:**
- Create: `src/triggers/engine.ts`
- Test: `tests/triggers/engine.test.ts`

**Interfaces:**
- Consumes: everything above — `createTriggerStore`, `createFireTrigger`, `createScheduler`, `createFileWatcher`, `createChainObserver`, `syncRepoTriggers`, `getTrigger`/`TRIGGERS`; `createTriggerSecretStore` (Task 18, imported but the engine takes it injected so this task doesn't depend on 18 landing first — pass a minimal secret-store interface); `JobStore`; `loadConfig`.
- Produces:

```ts
export type TriggersEngine = {
  store: TriggerStore;
  secretStore: TriggerSecretStore;      // injected
  fire: FireTrigger;
  handleJobSettled: (job: JobRecord, status: JobStatus.Done | JobStatus.Failed) => void;
  start(): void;   // reconcile schedules + start scheduler + start watcher + sync repo defs
  stop(): Promise<void>;
};
export function createTriggersEngine(deps: {
  jobStore: JobStore;
  runsRoot: string;
  triggersDbPath: string;            // AGENT_QUEUE_PATH (same jobs.db dir)
  secretStore: TriggerSecretStore;
  repoDefs?: Record<string, TriggerDef>;  // defaults to TRIGGERS
  config?: { pollMs?: number; maxChainDepth?: number; watchRoot?: string };
}): TriggersEngine;
```

  Construction order (documented inline): build `store = createTriggerStore({ path: triggersDbPath })`; `fire = createFireTrigger({ triggerStore: store, jobStore, runsRoot, maxChainDepth })`; `chain = createChainObserver({ triggerStore: store, fire, maxChainDepth })`; `scheduler = createScheduler({ triggerStore: store, fire, pollMs })`; `watcher = createFileWatcher({ triggerStore: store, fire, watchRoot })`. `start()` = `syncRepoTriggers(store, repoDefs)` → `scheduler.start()` (its own `reconcile` runs first) → `watcher.start()`. `stop()` = `scheduler.stop()` → `await watcher.stop()` → `store.close()`. `handleJobSettled` delegates to `chain.handleJobSettled`.

- [ ] **Step 1: Write the failing test** — `start()` then `stop()` runs clean with fakes; `handleJobSettled` forwards to the chain observer:

```ts
test('engine start/stop lifecycle runs clean and syncs repo defs', async () => { /* ... */ });
// I3: stop() releases every long-lived handle — the scheduler interval, the
// chokidar watchers, and the trigger-store DB — leaving nothing open.
test('stop() clears the scheduler interval, closes watchers, and closes the DB', async () => {
  // inject a fake setInterval/clearInterval + a fake chokidar watch (recording .close()),
  // start() then stop(); assert clearInterval was called with the interval start() set,
  // every watcher.close() ran, and a post-stop store.get() throws (DB closed).
});
```

- [ ] **Step 2: Run test to verify it fails** → FAIL.
- [ ] **Step 3: Write minimal implementation** per the Produces block. `maxChainDepth = () => config?.maxChainDepth ?? (loadConfig().values.AGENT_TRIGGERS_MAX_CHAIN_DEPTH as number)`; `pollMs`/`watchRoot` resolved the same way from config with the injected override winning.
- [ ] **Step 4: Run test to verify it passes** → PASS.
- [ ] **Step 5: Gate + commit** — `bun run typecheck && bun run lint:file -- src/triggers/engine.ts tests/triggers/engine.test.ts`.

```bash
git add src/triggers/engine.ts tests/triggers/engine.test.ts
git commit -m "feat(triggers): engine wiring (store+fire+scheduler+watcher+chain+sync)"
```

*Model: Opus (lifecycle ordering correctness) — light adversarial check on start/stop order.*

### Task 16: Daemon lifecycle-binding

**Files:**
- Modify: `src/daemon/core.ts` (`CreateDaemonOptions` + `start`/`stop`), `src/cli/daemon.ts` (`buildRealDaemon`), `src/server/main.ts` (standalone construct + inject)
- Test: `tests/daemon/core-triggers.test.ts`

**Interfaces:**
- Consumes: `TriggersEngine`, `createTriggersEngine`, `createTriggerSecretStore`.
- Produces:
  - `CreateDaemonOptions` gains `triggers?: { start(): void; stop(): Promise<void> | void }`.
  - `createDaemon.start()`: after `startWebServer(...)` returns (step 5), call `opts.triggers?.start()` (step 5b — AFTER pool+server per D2). `stop()`: call `await opts.triggers?.stop()` FIRST (before `opts.pool.stop(...)` — stop producing before draining consumers per D2).
  - `StartOptions` (main.ts) gains `triggers?: TriggersEngine`; `ServerDeps` gains `triggers?: TriggersEngine`. In injected (daemon) mode, the daemon passes its engine through `opts.triggers`. In standalone mode, `startWebServer` constructs its own engine AND wires the pool's `onSettled` to it (see below), and starts/stops it on the shutdown hook — symmetric with the existing standalone-pool duality.

- [ ] **Step 1: Write the failing test** — daemon start calls `triggers.start()` after the server is up; stop calls `triggers.stop()` before `pool.stop()` (assert call order with spies):

```ts
test('daemon starts triggers AFTER server and stops them BEFORE the pool', async () => {
  const order: string[] = [];
  const triggers = { start: () => order.push('trg.start'), stop: async () => { order.push('trg.stop'); } };
  const pool = { start: () => order.push('pool.start'), stop: async () => { order.push('pool.stop'); }, /* ... */ } as any;
  // startWebServer spy pushes 'server.start'; run start() then stop().
  // expect start order: [..., 'pool.start', 'server.start', 'trg.start']
  // expect stop order:  ['trg.stop', 'pool.stop', ...]
});
// I3 invariant: a standalone startWebServer with the flag OFF (the default,
// as every existing server test) does NOT construct/start a triggers engine —
// deps.triggers is undefined and no scheduler/watcher handle is opened.
test('standalone startWebServer does NOT start triggers when AGENT_TRIGGERS_ENABLED is off', () => {
  const h = startWebServer({ port: 0, ...authPaths() }); // no queue, flag default off
  // assert: the /api/triggers route degrades via need() (503), i.e. no engine wired;
  // and (handle-leak guard) stopping the server + running onShutdown leaves no open timer/watcher.
  h.server.stop();
});
```

- [ ] **Step 2: Run test to verify it fails** → FAIL.
- [ ] **Step 3: Write minimal implementation.**
  - `core.ts`: add the `triggers?` option; in `start()` after `server = handle.server; started = true;` and before `onShutdown`, insert `opts.triggers?.start();`. In `stop()`, insert `await opts.triggers?.stop();` as the FIRST awaited line after `started = false`.
  - `cli/daemon.ts buildRealDaemon`: after `jobStore`, build `const secretStore = createTriggerSecretStore({});` and `const triggers = createTriggersEngine({ jobStore, runsRoot, triggersDbPath: String(cfg.AGENT_QUEUE_PATH), secretStore });`. Build the pool with `onSettled: triggers.handleJobSettled` added to the existing `createWorkerPool({...})` opts. Pass `triggers` to `createDaemon({...})` AND to the injected `startWebServer` (via `createDaemon` → it already calls `startWebServer`; thread `triggers` through `CreateDaemonOptions`→the `startWebServer` call in `core.ts` step 5, adding `triggers: opts.triggers` to that opts object).
  - `main.ts`: accept `opts.triggers`; if injected mode (`opts.queue`) use `opts.triggers` as `deps.triggers` (daemon owns lifecycle — the daemon always constructs+injects its engine, so injected mode NEVER consults the flag). **If standalone, auto-construct the engine ONLY when `opts.triggers` is absent AND `cfg.AGENT_TRIGGERS_ENABLED` is truthy (I3) — otherwise leave `deps.triggers` undefined and start nothing** (this is why an existing `startWebServer()` test, which sets neither, spins NO scheduler/watcher and leaks no handle). When it does construct: build `secretStore` + `triggers` engine, add `onSettled: triggers.handleJobSettled` to the standalone `createWorkerPool`, `triggers.start()` after `pool.start()`, set `deps.triggers = triggers`, and — symmetric with the standalone pool teardown, which runs via `onShutdown` (NOT the returned `server.stop()`; that only stops the HTTP listener) — extend the SAME standalone `onShutdown` callback to `await triggers.stop()` **FIRST**, before `await pool.stop()` then `jobStore.close()` (stop producing before draining consumers, per D2). `triggers.stop()` releases the scheduler interval, closes all chokidar watchers, and closes the trigger store DB handle.
- [ ] **Step 4: Run test to verify it passes** → PASS.
- [ ] **Step 5: Gate + commit** — `bun run typecheck && bun run lint:file -- src/daemon/core.ts src/cli/daemon.ts src/server/main.ts src/server/app.ts tests/daemon/core-triggers.test.ts && bun run test -- -t "starts triggers AFTER"`.

```bash
git add src/daemon/core.ts src/cli/daemon.ts src/server/main.ts src/server/app.ts tests/daemon/core-triggers.test.ts
git commit -m "feat(triggers): lifecycle-bind engine to daemon (start after pool+server, stop first)"
```

*Model: Opus (lifecycle ordering is a §7.2-adjacent correctness point; the stop-first / start-last order prevents a fire enqueuing onto a draining pool).* Note: `app.ts` `ServerDeps.triggers?` field is added here so the routes (Increment 5) can `need(deps.triggers, 'triggers')`.

### Task 17: Increment 3 boundary gate

- [ ] **Step 1: Run the full gate** — `bun run check`. Fully green including docs-check (Task-1 stub; no exemption).
- [ ] **Step 2: Update the SDD ledger** with Increment 3's commits + HARD-task verdicts.

*Model: controller.*

---

## Increment 4 — Webhooks + provenance threading (HARD §7.1)

The production-grade webhook receiver (token + HMAC + replay window + body cap + rate limit) and the generalization of `markDaemonOrigin` so trigger-fired runs carry the right `RunOrigin`.

### Task 18: Webhook secret store (~/.agent/trigger-secrets.json)

**Files:**
- Create: `src/triggers/secret-store.ts`
- Test: `tests/triggers/secret-store.test.ts`

**Interfaces:**
- Consumes: `randomBytes` from `node:crypto`; the `~/.agent` `0600`/`0700` atomic-write idiom from `device-registry.ts`.
- Produces:

```ts
export type TriggerSecretStore = {
  /** Mint a new HMAC secret, persist under a fresh secretRef, return both. */
  mint(): { secretRef: string; hmacSecret: string };
  /** Look up the HMAC secret for a secretRef (undefined if absent). */
  get(secretRef: string): string | undefined;
  /** Drop a secret (on trigger delete). */
  remove(secretRef: string): void;
};
export function defaultTriggerSecretsPath(): string; // ~/.agent/trigger-secrets.json
export function createTriggerSecretStore(config: { path?: string }): TriggerSecretStore;
```

  File format: `{ [secretRef]: hmacSecretHex }`. `0700` dir + `0600` file, atomic temp+rename (byte-for-byte `device-registry.ts persist`). Fail-closed on a corrupt (present-but-unparseable) file — throw, never silently return `{}` (matches `device-registry.ts load`). `mint()` uses `randomBytes(32).toString('hex')` for the secret and `randomBytes(9).toString('hex')` for the ref. **The secret is NEVER logged, never returned in a DTO, never set as a span attribute** (§7.1).

- [ ] **Step 1: Write the failing tests** — round-trip a minted secret; `0600` mode; corrupt file throws:

```ts
test('mint persists a secret retrievable by ref; file is 0600', () => { /* statSync mode & 0o777 === 0o600 */ });
test('a corrupt secrets file fails closed (throws on load)', () => { /* write "{" then create → throws */ });
```

- [ ] **Step 2: Run tests to verify they fail** → FAIL.
- [ ] **Step 3: Write minimal implementation** — copy the `device-registry.ts` structure (load/persist/atomic write, fail-closed load) adapting the record shape to a `Record<string,string>` map.
- [ ] **Step 4: Run tests to verify they pass** → PASS.
- [ ] **Step 5: Gate + commit** — `bun run typecheck && bun run lint:file -- src/triggers/secret-store.ts tests/triggers/secret-store.test.ts`.

```bash
git add src/triggers/secret-store.ts tests/triggers/secret-store.test.ts
git commit -m "feat(triggers): ~/.agent/trigger-secrets.json HMAC secret store (0600, fail-closed)"
```

*Model: **Opus implementer + adversarial verify** (HARD §7.1). Reviewer probes: file mode is `0600`, dir `0700`, writes atomic, load fail-closed, and the secret never crosses into any log/DTO/span.*

### Task 19: POST /hooks/:token handler (HARD §7.1)

**Files:**
- Create: `src/triggers/webhook-verify.ts`, `src/server/hooks/webhook.ts`
- Test: `tests/triggers/webhook-verify.test.ts`, `tests/server/hooks-webhook.test.ts`

**Interfaces:**
- Consumes: `createHash`, `createHmac`, `timingSafeEqual` from `node:crypto`; `TriggerStore`, `TriggerSecretStore`, `FireTrigger`; `WebhookConfig`, `TriggerType`; the run-dir limiter interface `{ allow(): boolean }`; `withServerRequestSpan`.
- Produces:
  - `src/triggers/webhook-verify.ts` (pure, unit-testable):
    - `hashToken(token: string): string` = `createHash('sha256').update(token).digest('hex')`.
    - `constantTimeEqualHex(a: string, b: string): boolean` — length-guard then `timingSafeEqual(Buffer.from(a,'hex'), Buffer.from(b,'hex'))`.
    - `verifyHmac(opts: { rawBody: string; secret: string; signatureHeader: string | null; timestampHeader: string | null; now: number; windowMs: number }): { ok: true } | { ok: false; status: 401 | 409 }`. **The `timestampHeader` is a unix-time value in SECONDS (the GitHub/Stripe `X-…-Timestamp` convention), NOT milliseconds (M4).** Parse it with `Number(...)`, reject a non-finite/absent value with `409`, then convert to ms internally: `const tsMs = seconds * 1000`. Replay check FIRST: `if (!Number.isFinite(seconds) || Math.abs(opts.now - tsMs) > opts.windowMs) return { ok: false, status: 409 }` — this also rejects a client that mistakenly sends MILLISECONDS (a ~13-digit value read as seconds lands ~thousands of years in the future, far outside the window → `409`). Then compute the signature over the RAW seconds string exactly as received — `createHmac('sha256', secret).update(\`${timestampHeader}.${rawBody}\`).digest('hex')` (Stripe signs the header value verbatim, so `${seconds}.${body}`) — and `constantTimeEqualHex` it against the presented signature (else `401`).
  - `src/server/hooks/webhook.ts`: `handleWebhook(token: string, req: Request, deps: { triggerStore: TriggerStore; secretStore: TriggerSecretStore; fire: FireTrigger; runLimiter?: { allow(): boolean }; replayWindowMs?: number }): Promise<Response>`.

- [ ] **Step 1: Write the failing tests.** Verify (pure):

```ts
test('verifyHmac accepts a correct signature within the window', () => {
  // timestamp = String(Math.floor(now/1000)) (SECONDS); sig over `${ts}.${body}` → ok:true
});
test('verifyHmac rejects a bad signature with 401', () => { /* ok:false status 401 */ });
test('verifyHmac rejects a stale timestamp with 409 (replay window)', () => {
  // ts = String(Math.floor(now/1000) - 600) (10 min old, window 5 min) → 409
});
// M4: a client that sends MILLISECONDS instead of seconds is rejected (409), not accepted.
test('verifyHmac rejects a millisecond-unit timestamp with 409 (wrong unit)', () => {
  // ts = String(now) (ms, ~13 digits) → interpreted as seconds → far future → 409
});
```

  Handler:

```ts
test('unknown token → 404 (constant-time lookup, no trigger leak)', async () => { /* ... */ });
test('valid HMAC webhook fires the trigger, 202 {jobId,runId}, body in {{webhook.body}}', async () => { /* ... */ });
test('bad HMAC → 401, no fire', async () => { /* ... */ });
test('rate limiter exhausted → 429, no fire', async () => { /* ... */ });
```

- [ ] **Step 2: Run tests to verify they fail** → FAIL.
- [ ] **Step 3: Write minimal implementation.** `webhook-verify.ts` per spec (write `verifyHmac` in full — replay check FIRST, then constant-time signature compare). `webhook.ts handleWebhook`:

```ts
export async function handleWebhook(token, req, deps): Promise<Response> {
  return withServerRequestSpan({ route: '/hooks/:token', method: req.method }, async (rec) => {
    // Timing-safe lookup by construction: we SHA-256 the presented token, then
    // find the row by the indexed token_hash. The comparison the DB performs is
    // over the 256-bit HASH, never the raw token — so lookup timing reveals
    // nothing exploitable about a valid token (an attacker would need a SHA-256
    // preimage of a stored hash). No separate constant-time compare is needed
    // here (M3 removed a dead self-comparison of presentedHash against itself);
    // constantTimeEqualHex is reserved for the HMAC signature compare in
    // verifyHmac, where two independently-derived hex digests are checked.
    const presentedHash = hashToken(token);
    const trigger = deps.triggerStore.getByTokenHash(presentedHash);
    if (!trigger || trigger.type !== TriggerType.Webhook || !trigger.enabled) {
      rec.status(404); return json({ error: 'not found' }, 404); // never reveal token validity beyond 404
    }
    // Body cap is enforced by Bun.serve maxRequestBodySize (413 before we run);
    // read the RAW body ONCE for both HMAC and {{webhook.body}} (never re-parse).
    const rawBody = await req.text();
    const cfg = trigger.config as WebhookConfig;
    if (cfg.hmac) {
      const secret = trigger.secretRef ? deps.secretStore.get(trigger.secretRef) : undefined;
      if (!secret) { rec.status(500); return json({ error: 'secret missing' }, 500); }
      const v = verifyHmac({
        rawBody, secret,
        signatureHeader: req.headers.get('x-agent-signature'),
        timestampHeader: req.headers.get('x-agent-timestamp'),
        now: Date.now(),
        windowMs: deps.replayWindowMs ?? 5 * 60_000,
      });
      if (!v.ok) { rec.status(v.status); return json({ error: 'signature rejected' }, v.status); }
    }
    const limiter = deps.runLimiter ?? ALWAYS_ALLOW;
    if (!limiter.allow()) { rec.status(429); return json({ error: 'rate limited' }, 429); }
    const result = await deps.fire(trigger, { reason: 'webhook', vars: { 'webhook.body': rawBody } });
    if (!result.fired) { rec.status(202); return json({ skipped: result.outcome }, 202); }
    rec.status(202);
    return json({ jobId: result.jobId, runId: result.runId }, 202);
  });
}
```

  (Lookup safety: `getByTokenHash` returns the row whose `token_hash === presentedHash`. Because the match is over SHA-256 digests (not the raw token), the index lookup leaks nothing exploitable — the dead self-compare of `presentedHash` against itself is removed (M3). `constantTimeEqualHex` remains in `webhook-verify.ts` for the HMAC signature compare only.)

- [ ] **Step 4: Run tests to verify they pass** → PASS.
- [ ] **Step 5: Gate + commit** — `bun run typecheck && bun run lint:file -- src/triggers/webhook-verify.ts src/server/hooks/webhook.ts tests/triggers/webhook-verify.test.ts tests/server/hooks-webhook.test.ts`.

```bash
git add src/triggers/webhook-verify.ts src/server/hooks/webhook.ts tests/triggers/webhook-verify.test.ts tests/server/hooks-webhook.test.ts
git commit -m "feat(triggers): POST /hooks/:token receiver (token/HMAC/replay/cap/rate-limit)"
```

*Model: **Opus implementer + adversarial verify** (HARD §7.1). Reviewer probes: HMAC computed over the RAW body (not a re-serialized parse), replay window enforced BEFORE the signature compare short-circuits, constant-time compare, secret never logged/returned, and the body read exactly once.*

### Task 20: Generalize markDaemonOrigin + wire /hooks route

**Files:**
- Modify: `src/server/jobs/dispatch.ts` (`markDaemonOrigin` → origin-aware), `src/server/jobs/retry.ts` (carry `origin`/`chainDepth` onto the re-enqueue), `src/server/app.ts` (the `/hooks/:token` branch)
- Test: `tests/server/dispatch-origin.test.ts`, `tests/server/app-hooks-route.test.ts`, `tests/server/jobs/retry-origin.test.ts`

**Interfaces:**
- Consumes: `RunOrigin`; `handleWebhook` (Task 19); `deps.triggers` (Task 16).
- Produces:
  - `dispatch.ts`: rename the intent of `markDaemonOrigin` → `markJobOrigin(runsRoot, runId, origin)`; the `createJobDispatch` wrapper passes `job.origin ?? RunOrigin.Daemon`. A job with no origin (direct enqueue) still stamps `Daemon` (unchanged behavior); a trigger-fired job stamps its `Schedule`/`Webhook`/`Api`.
  - `retry.ts` (I6): the lineage-preserving re-enqueue in `handleJobRetry` must carry the ORIGINAL job's provenance forward — extend the `deps.jobStore.enqueue({...})` call with `origin: job.origin` and `chainDepth: job.chainDepth`. Without this, retrying a webhook/schedule-origin (or chained) job silently resets it to `origin=undefined`/`chainDepth=0`, so the retried run drops off the `?origin=` facet and escapes the chain-depth cap. The `origin`/`chainDepth` fields exist on `JobRecord`/`JobInput` as of Task 4, so this is a pure field carry-through:

```ts
  const retry = deps.jobStore.enqueue({
    kind: job.kind,
    payload: job.payload,
    retriedFrom: job.id,
    origin: job.origin,          // I6: preserve provenance across a retry
    chainDepth: job.chainDepth,  // I6: keep the chain-depth guard intact
    runId,
  });
```

  - `app.ts`: a branch in `buildFetch` (after `enforcePerimeter`, BEFORE the `/api` guard) — `const hookMatch = url.pathname.match(/^\/hooks\/([^/]+)$/); if (req.method === 'POST' && hookMatch?.[1]) { const t = deps.triggers; if (!t) return json({ error: 'triggers unavailable' }, 503); return handleWebhook(hookMatch[1], req, { triggerStore: t.store, secretStore: t.secretStore, fire: t.fire, runLimiter: deps.runLimiter }); }`. It sits INSIDE the perimeter (already enforced) but OUTSIDE the session guard (no bearer required — webhooks authenticate via token/HMAC).

- [ ] **Step 1: Write the failing tests:**

```ts
test('markJobOrigin stamps the job.origin when present, Daemon by default', async () => { /* Schedule vs Daemon marker */ });
test('POST /hooks/:token routes to handleWebhook without a bearer, inside the perimeter', async () => {
  // a request with a forbidden Host still 403s (perimeter); a loopback POST with no Authorization reaches the webhook handler (404 unknown token, NOT 401 unauthorized).
});
// I6: retrying a trigger-fired job preserves origin + chainDepth on the new job.
test('retry of an origin=webhook job keeps origin + chainDepth', async () => {
  // enqueue a job with origin=Webhook, chainDepth=2; mark it Failed; POST /api/jobs/:id/retry;
  // assert the re-enqueued job has origin === RunOrigin.Webhook and chainDepth === 2.
});
```

- [ ] **Step 2: Run tests to verify they fail** → FAIL.
- [ ] **Step 3: Write minimal implementation** per the Produces block. Keep the old export name as an alias if any other caller imports `markDaemonOrigin` (grep first; if only the wrapper uses it, rename cleanly).
- [ ] **Step 4: Run tests to verify they pass** → PASS.
- [ ] **Step 5: Gate + commit** — `bun run typecheck && bun run lint:file -- src/server/jobs/dispatch.ts src/server/jobs/retry.ts src/server/app.ts tests/server/dispatch-origin.test.ts tests/server/app-hooks-route.test.ts tests/server/jobs/retry-origin.test.ts && bun run test -- -t "hooks"`.

```bash
git add src/server/jobs/dispatch.ts src/server/jobs/retry.ts src/server/app.ts tests/server/dispatch-origin.test.ts tests/server/app-hooks-route.test.ts tests/server/jobs/retry-origin.test.ts
git commit -m "feat(triggers): origin-aware dispatch marker + retry provenance carry + /hooks route outside the /api guard"
```

*Model: Opus (the perimeter/guard boundary placement is security-sensitive — a webhook route accidentally behind the bearer guard would 401 every legitimate call; one accidentally outside the perimeter would be a CSRF/rebinding hole; and the retry carry-through keeps the chain-depth cap honest across a retry).*

### Task 21: Increment 4 boundary gate

- [ ] **Step 1: Run the full gate** — `bun run check`. Fully green including docs-check (Task-1 stub; no exemption).
- [ ] **Step 2: Update the SDD ledger** with Increment 4 commits + the §7.1 review verdicts.

*Model: controller.*

---

## Increment 5 — API routes (seven /api/triggers*)

The seven routes, all mutating ones behind `requireTrustedLocal` (trigger creation is persistent code-execution-by-schedule), repo-origin rows pause/resume-only, and the action-sub-path-before-bare-`:id` ordering `app.ts` already uses.

### Task 22: Trigger read handlers (list / detail / firings)

**Files:**
- Create: `src/server/triggers/list.ts`, `src/server/triggers/detail.ts`, `src/server/triggers/firings.ts`, `src/server/triggers/dto.ts` (the `Trigger`→`TriggerDTO` projector)
- Test: `tests/server/triggers-read.test.ts`

**Interfaces:**
- Consumes: `deps.triggers` (`ServerDeps.triggers`); `TriggerListResponseSchema`, `TriggerDtoSchema`, `TriggerFiringListQuerySchema`, `TriggerFiringListResponseSchema`; `need` from `app.ts`.
- Produces:
  - `dto.ts`: `toTriggerDto(t: Trigger, opts?: { publicBaseUrl?: string }): TriggerDTO` — projects the record onto the wire; **omits** `secretRef`; sets `webhookUrl` for webhook triggers when a `publicBaseUrl` is known (the URL contains the token only at create time — the DTO's `webhookUrl` is the base path `/hooks/…` WITHOUT the raw token for listing; the raw token is shown once in the create response only). `toTriggerFiringDto(f: TriggerFiring): TriggerFiringDTO`.
  - `list.ts`: `handleTriggerList(deps): Response` → `json(TriggerListResponseSchema.parse({ items: store.list().map((t) => toTriggerDto(t)) }))`.
  - `detail.ts`: `handleTriggerDetail(id, deps): Response` → 404 if absent, else the DTO.
  - `firings.ts`: `handleTriggerFirings(id, params, deps): Response` → parse `TriggerFiringListQuerySchema`, `store.listFirings(id, q)`, project.

- [ ] **Step 1: Write the failing tests:**

```ts
test('GET /api/triggers lists projected DTOs without secretRef', () => { /* assert no secretRef key */ });
test('GET /api/triggers/:id → 404 for an unknown id', () => { /* ... */ });
test('GET /api/triggers/:id/firings paginates newest-first', () => { /* ... */ });
```

- [ ] **Step 2: Run tests to verify they fail** → FAIL.
- [ ] **Step 3: Write minimal implementation** per the Produces block (all reads; no gating — reads are behind the standard session guard like every `/api` route).
- [ ] **Step 4: Run tests to verify they pass** → PASS.
- [ ] **Step 5: Gate + commit** — `bun run typecheck && bun run lint:file -- src/server/triggers/*.ts tests/server/triggers-read.test.ts`.

```bash
git add src/server/triggers/list.ts src/server/triggers/detail.ts src/server/triggers/firings.ts src/server/triggers/dto.ts tests/server/triggers-read.test.ts
git commit -m "feat(triggers): read routes (list/detail/firings) + DTO projector (no secretRef)"
```

*Model: Sonnet.*

### Task 23: Trigger mutating handlers (create / patch / delete)

**Files:**
- Create: `src/server/triggers/create.ts`, `src/server/triggers/patch.ts`, `src/server/triggers/delete.ts`, `src/server/triggers/config-parse.ts`
- Test: `tests/server/triggers-mutate.test.ts`

**Interfaces:**
- Consumes: `requireTrustedLocal`; `TriggerCreateRequestSchema`/`TriggerPatchRequestSchema`/`TriggerCreateResponseSchema`; per-type config schemas + `validateCron`; `confineWatchPath` + `expandHome` (Task 12) + `loadConfig` (for `AGENT_TRIGGERS_WATCH_ROOT`); `hashToken` (Task 19); `TriggerOrigin` (the M2 duplicate-name pre-check); `deps.triggers`, `deps.policy`, `deps.publicBaseUrl`; `computeNextRun`.
- Produces:
  - `config-parse.ts`: `parseTriggerConfig(type: TriggerTypeWire, raw: unknown): TriggerConfig` — dispatches to the per-type schema (`CronConfigSchema`/`WebhookConfigSchema`/`FileConfigSchema`/`JobChainConfigSchema`); for cron, additionally `validateCron(schedule, timezone)` (throws a typed 400-mapped error on a bad pattern); for file, `confineWatchPath(path, expandHome(cfg.AGENT_TRIGGERS_WATCH_ROOT))` at create time (§7.4 — the SAME expanded root the watcher uses, so a create-time-accepted path can never be watch-time-rejected). Returns the typed config or throws.
  - `create.ts`: `handleTriggerCreate(req, deps, guard): Promise<Response>` —
    1. `requireTrustedLocal` FIRST (403 with zero side effect).
    2. Parse `TriggerCreateRequestSchema` (400 on failure).
    3. `parseTriggerConfig(body.type, body.config)` (400 on bad config/cron).
    3b. **Duplicate-name pre-check (M2):** `if (store.getByName(body.name, TriggerOrigin.Console)) return 409` ("a console trigger with that name already exists") — a clean conflict BEFORE any token mint / secret mint / row insert, rather than letting the `UNIQUE(name, origin)` constraint surface as a 500. (Repo-origin rows share the name space only within `origin=repo`, so a console create never conflicts with a repo def.)
    4. For a webhook trigger: mint a 128-bit path token (`randomBytes(16).toString('hex')`), `tokenHash = hashToken(token)`; if `config.hmac`, `secretStore.mint()` → `{ secretRef }`. Store row with `origin=console`, `tokenHash`, `secretRef`.
    5. For a cron trigger: seed `nextRunAt = computeNextRun(...at create...)`.
    6. `store.create(input, { tokenHash })`; `recordTriggerRegister(trigger)`.
    7. Return `201 TriggerCreateResponseSchema.parse({ trigger: toTriggerDto(...), webhookToken: token /* once */, webhookUrl: \`${publicBaseUrl}/hooks/${token}\` })` (token/url present ONLY for a webhook create).
  - `patch.ts`: `handleTriggerPatch(id, req, deps, guard): Promise<Response>` — `requireTrustedLocal` FIRST; 404 if absent; parse `TriggerPatchRequestSchema`; **repo-origin rows: reject any field other than `enabled` with 403** ("repo triggers are pause/resume-only"); apply `store.update`; return the DTO. If a cron config/`enabled` change requires it, recompute `nextRunAt`.
  - `delete.ts`: `handleTriggerDelete(id, deps, guard): Response` — `requireTrustedLocal` FIRST; 404 if absent; **repo-origin rows → 403** ("repo triggers cannot be deleted; edit `triggers/`"); else `secretStore.remove(secretRef?)` + `store.remove(id)`; `200`.

- [ ] **Step 1: Write the failing tests:**

```ts
test('create requires trusted-local (403 from a non-loopback principal, zero side effect)', async () => { /* ... */ });
test('create a webhook trigger returns the token ONCE + a /hooks URL', async () => { /* token present, then GET list has no token */ });
test('create rejects a bad cron pattern with 400', async () => { /* schedule "not a cron" */ });
test('create a second console trigger with a duplicate name → 409 (no side effect)', async () => {
  // create 'nightly' (200); create 'nightly' again → 409; assert no second row + no token minted.
});
test('patch a repo trigger: enabled OK, config change 403', async () => { /* ... */ });
test('delete a repo trigger → 403; delete a console trigger → 200 + secret removed', async () => { /* ... */ });
```

- [ ] **Step 2: Run tests to verify they fail** → FAIL.
- [ ] **Step 3: Write minimal implementation** per the Produces block. All three mutating handlers call `requireTrustedLocal(req, guard, deps.policy)` as the FIRST statement (the `handleDeviceRevoke` precedent).
- [ ] **Step 4: Run tests to verify they pass** → PASS.
- [ ] **Step 5: Gate + commit** — `bun run typecheck && bun run lint:file -- src/server/triggers/create.ts src/server/triggers/patch.ts src/server/triggers/delete.ts src/server/triggers/config-parse.ts tests/server/triggers-mutate.test.ts`.

```bash
git add src/server/triggers/create.ts src/server/triggers/patch.ts src/server/triggers/delete.ts src/server/triggers/config-parse.ts tests/server/triggers-mutate.test.ts
git commit -m "feat(triggers): mutating routes (create/patch/delete) behind requireTrustedLocal + repo-origin rules"
```

*Model: **Opus implementer + adversarial verify**. Reviewer probes: trusted-local gate is FIRST (zero side effect on reject) in ALL THREE handlers; the webhook token is returned exactly once and never persisted raw; repo rows are genuinely pause/resume-only; a bad cron is a 400 not a 500.*

### Task 24: Manual test-fire route

**Files:**
- Create: `src/server/triggers/fire.ts`
- Test: `tests/server/triggers-fire.test.ts`

**Interfaces:**
- Consumes: `requireTrustedLocal`; `deps.triggers.fire`; `JobLaunchResponseSchema`.
- Produces: `handleTriggerFire(id, req, deps, guard): Promise<Response>` — `requireTrustedLocal` FIRST; 404 if absent; `await deps.triggers.fire(trigger, { reason: 'manual', bypassOverlap: true })` (a test-fire ignores overlap protection); return `202 JobLaunchResponseSchema.parse({ jobId, runId })`.

- [ ] **Step 1: Write the failing test:**

```ts
test('POST /api/triggers/:id/fire test-fires immediately (202 {jobId,runId}), trusted-local gated', async () => { /* ... */ });
```

- [ ] **Step 2: Run test to verify it fails** → FAIL.
- [ ] **Step 3: Write minimal implementation** per the Produces block.
- [ ] **Step 4: Run test to verify it passes** → PASS.
- [ ] **Step 5: Gate + commit** — `bun run typecheck && bun run lint:file -- src/server/triggers/fire.ts tests/server/triggers-fire.test.ts`.

```bash
git add src/server/triggers/fire.ts tests/server/triggers-fire.test.ts
git commit -m "feat(triggers): manual test-fire route (trusted-local, bypass overlap)"
```

*Model: Sonnet.*

### Task 25: Wire the seven routes into app.ts

**Files:**
- Modify: `src/server/app.ts` (`handleApi` routing block)
- Test: `tests/server/triggers-routing.test.ts`

**Interfaces:**
- Consumes: all seven handlers; `need(deps.triggers, 'triggers')`.
- Produces: the routing block, placed with the SAME action-sub-path-before-bare-`:id` discipline `app.ts` uses for `/api/jobs/:id/cancel` and `/api/devices/:id/revoke`. Order:
  1. `GET /api/triggers` → `handleTriggerList`
  2. `POST /api/triggers` → `handleTriggerCreate` (guard passed)
  3. `GET /api/triggers/:id/firings` (regex `^\/api\/triggers\/([^/]+)\/firings$`) — BEFORE the bare `:id`.
  4. `POST /api/triggers/:id/fire` (regex `^\/api\/triggers\/([^/]+)\/fire$`) — BEFORE the bare `:id`.
  5. `GET /api/triggers/:id` (bare `:id`) → `handleTriggerDetail`
  6. `PATCH /api/triggers/:id` → `handleTriggerPatch`
  7. `DELETE /api/triggers/:id` → `handleTriggerDelete`

  Each `need(deps.triggers, 'triggers')` so a fixture without the engine degrades to 503 (the `need()` idiom). `rec.status(res.status)` on each.

- [ ] **Step 1: Write the failing tests** — the action sub-paths resolve to the right handler (a trigger literally named `fire` or `firings` can't shadow the action paths), and detail/patch/delete share the bare `:id`:

```ts
test('the /firings and /fire action sub-paths match before bare :id', async () => { /* ... */ });
test('unconfigured triggers engine degrades to 503 via need()', async () => { /* ... */ });
```

- [ ] **Step 2: Run tests to verify they fail** → FAIL.
- [ ] **Step 3: Write minimal implementation** — insert the routing block (mirroring the existing `/api/jobs/:id/...` block structure) in `handleApi`, after the jobs routes.
- [ ] **Step 4: Run tests to verify they pass** → PASS.
- [ ] **Step 5: Gate + commit** — `bun run typecheck && bun run lint:file -- src/server/app.ts tests/server/triggers-routing.test.ts`.

```bash
git add src/server/app.ts tests/server/triggers-routing.test.ts
git commit -m "feat(triggers): route the seven /api/triggers* endpoints (action-before-:id order)"
```

*Model: Sonnet.*

### Task 26: Increment 5 boundary gate

- [ ] **Step 1: Run the full gate** — `bun run check`. Fully green including docs-check (Task-1 stub; no exemption).
- [ ] **Step 2: Update the SDD ledger** with Increment 5 commits + the create/patch/delete review verdict.

*Model: controller.*

---

## Increment 6 — Console (live Triggers tab)

Replace the static stub with a live `apiFetch`-driven tab: list, create dialog (per-type forms), enable/disable toggle, manual fire, and a firing-history drawer with run deep-links. Plain `apiFetch` hooks, no query lib. **Every user-provided string (trigger name especially) is React-escaped — never `dangerouslySetInnerHTML`** (the Slice-25b stored-XSS lesson). Web gate = `cd web && bun run typecheck && bun run test`.

### Task 27: use-triggers + use-trigger-firings hooks

**Files:**
- Create: `web/src/features/ops/use-triggers.ts`, `web/src/features/ops/use-trigger-firings.ts`
- Test: `web/src/features/ops/use-triggers.test.ts`

**Interfaces:**
- Consumes: `apiFetch` from `../../shared/contract/client.ts`; `TriggerListResponseSchema`, `TriggerFiringListResponseSchema`, `TriggerDtoSchema`, `TriggerCreateResponseSchema`, `JobLaunchResponseSchema` from `@contracts`.
- Produces:
  - `useTriggers()` → `{ triggers, error, refresh, create(body), setEnabled(id, enabled), remove(id), fire(id) }` — mirrors `use-jobs.ts` (a `reloadTick` refetch; `apiFetch('/triggers', { schema: TriggerListResponseSchema })`). `create` POSTs `TriggerCreateRequestSchema` and returns the once-only token/url; `setEnabled` PATCHes `{ enabled }`; `remove` DELETEs; `fire` POSTs `/triggers/:id/fire`. Each mutation calls `refresh()` after.
  - `useTriggerFirings(triggerId)` → `{ page, error, goNext, goFirst }` — the `use-jobs.ts` keyset pattern against `/triggers/:id/firings`.

- [ ] **Step 1: Write the failing test** (mock `apiFetch`; assert list loads + `setEnabled` re-fetches):

```ts
test('useTriggers loads the list and refetches after setEnabled', async () => { /* ... */ });
```

- [ ] **Step 2: Run test to verify it fails** — `cd web && bun run test -- use-triggers` → FAIL.
- [ ] **Step 3: Write minimal implementation** per the Produces block (copy `use-jobs.ts`'s effect/cursor structure).
- [ ] **Step 4: Run test to verify it passes** → PASS.
- [ ] **Step 5: Gate + commit** — `cd web && bun run typecheck && bun run test -- use-triggers`.

```bash
git add web/src/features/ops/use-triggers.ts web/src/features/ops/use-trigger-firings.ts web/src/features/ops/use-triggers.test.ts
git commit -m "feat(web): useTriggers + useTriggerFirings hooks (apiFetch, no query lib)"
```

*Model: Sonnet.*

### Task 28: Live Triggers tab list

**Files:**
- Modify: `web/src/features/ops/triggers-tab.tsx` (replace the static preview)
- Test: `web/src/features/ops/triggers-tab.test.tsx`

**Interfaces:**
- Consumes: `useTriggers`.
- Produces: the live list — columns **Type · Target job kind · Schedule · Enabled · Last fired** (extends the stub's three columns), an enable/disable toggle per row, a manual-fire button, a row click opening the firings drawer (Task 30), and a "New trigger" button opening the create dialog (Task 29). **Keep `data-testid="ops-triggers"`.** The trigger `name` renders via `{trigger.name}` (React-escaped) — assert an `<img onerror>`-shaped name renders as inert text. **Origin-conditional row affordances (M6):** mirror the backend rule (Task 23: repo rows are pause/resume-only) in the UI — **for a row with `origin === TriggerOriginWire.Repo`, render ONLY the enable/disable (pause/resume) toggle and the manual-fire button; DO NOT render a delete or edit affordance** (a small "repo-defined" badge conveys why). Console-origin rows render the full set (toggle · fire · delete). This keeps the UI from offering an action the API will 403.

- [ ] **Step 1: Write the failing tests:**

```ts
test('renders live trigger rows from useTriggers (keeps data-testid ops-triggers)', () => { /* ... */ });
test('a malicious trigger name renders as inert text (no dangerouslySetInnerHTML)', () => { /* <img src=x onerror=...> shows as text */ });
// M6: a repo-origin row shows pause/resume only — no delete/edit affordance.
test('a repo-origin row renders no delete/edit affordance (pause/resume only)', () => {
  // render a list with one origin=repo row + one origin=console row;
  // assert the console row has a delete control and the repo row does NOT (toggle present on both).
});
```

- [ ] **Step 2: Run tests to verify they fail** → FAIL.
- [ ] **Step 3: Write minimal implementation** — replace `TRIGGER_KINDS`/the static table with the live list; empty-state card stays when `triggers.length === 0` (updated copy: no longer "arrives in Slice 25"). Reuse the existing `CARD_CLASS`/`CARD_TITLE_CLASS`.
- [ ] **Step 4: Run tests to verify they pass** → PASS.
- [ ] **Step 5: Gate + commit** — `cd web && bun run typecheck && bun run test -- triggers-tab`.

```bash
git add web/src/features/ops/triggers-tab.tsx web/src/features/ops/triggers-tab.test.tsx
git commit -m "feat(web): live Triggers tab list (replaces the static stub, XSS-safe name)"
```

*Model: Sonnet.*

### Task 29: Create dialog (per-type config forms)

**Files:**
- Create: `web/src/features/ops/trigger-create-dialog.tsx`
- Test: `web/src/features/ops/trigger-create-dialog.test.tsx`

**Interfaces:**
- Consumes: `useTriggers().create`; the wire enums (`TriggerTypeWire`, `JobKindWire`).
- Produces: a dialog with a type selector switching among per-type forms — Cron (schedule + optional timezone/catchUp/allowOverlap), Webhook (hmac checkbox; on submit shows the returned token + `/hooks/…` URL ONCE with a "won't be shown again" note — the `PairDeviceDialog` precedent), File (path + events), JobChain (onKind/onName/onStatus) — plus the common target (kind + payload JSON textarea) and name. Client-side validates the payload textarea parses as JSON before POST. On success, `onCreated()` refreshes the list.

- [ ] **Step 1: Write the failing tests:**

```ts
test('cron create posts the schedule + target and refreshes', async () => { /* ... */ });
test('webhook create shows the token + /hooks URL exactly once', async () => { /* ... */ });
```

- [ ] **Step 2: Run tests to verify they fail** → FAIL.
- [ ] **Step 3: Write minimal implementation** per the Produces block.
- [ ] **Step 4: Run tests to verify they pass** → PASS.
- [ ] **Step 5: Gate + commit** — `cd web && bun run typecheck && bun run test -- trigger-create-dialog`.

```bash
git add web/src/features/ops/trigger-create-dialog.tsx web/src/features/ops/trigger-create-dialog.test.tsx
git commit -m "feat(web): trigger create dialog (per-type forms, once-only webhook token)"
```

*Model: Sonnet.*

### Task 30: Firings drawer + toggle/fire wiring

**Files:**
- Create: `web/src/features/ops/trigger-firings-drawer.tsx`
- Modify: `web/src/features/ops/triggers-tab.tsx` (mount the drawer + wire toggle/fire)
- Test: `web/src/features/ops/trigger-firings-drawer.test.tsx`

**Interfaces:**
- Consumes: `useTriggerFirings`; `useTriggers().setEnabled`/`.fire`.
- Produces: a drawer listing firings (firedAt · outcome · job/run deep-links into `/runs/$runId`), keyset pagination, opened by a row click; the enable/disable toggle calls `setEnabled`; the fire button calls `fire` then opens the drawer to show the new firing. Run deep-links use the router `Link` to `/runs/$runId` (the Jobs-tab precedent).

- [ ] **Step 1: Write the failing tests:**

```ts
test('drawer lists firings with a working /runs/:id deep-link', () => { /* ... */ });
test('toggle calls setEnabled; fire calls fire then shows the drawer', async () => { /* ... */ });
```

- [ ] **Step 2: Run tests to verify they fail** → FAIL.
- [ ] **Step 3: Write minimal implementation** per the Produces block.
- [ ] **Step 4: Run tests to verify they pass** → PASS.
- [ ] **Step 5: Gate + commit** — `cd web && bun run typecheck && bun run test -- trigger-firings-drawer`.

```bash
git add web/src/features/ops/trigger-firings-drawer.tsx web/src/features/ops/triggers-tab.tsx web/src/features/ops/trigger-firings-drawer.test.tsx
git commit -m "feat(web): firing-history drawer + enable/disable toggle + manual fire"
```

*Model: Sonnet.*

### Task 31: Increment 6 boundary gate

- [ ] **Step 1: Run the full gate** — `bun run check` (root + web). Fully green including docs-check (Task-1 stub; no exemption).
- [ ] **Step 2: Update the SDD ledger** with Increment 6 commits + the XSS-safety confirmation.

*Model: controller.*

---

## Increment 7 — CLI

### Task 32: agent triggers CLI

**Files:**
- Create: `src/cli/triggers.ts`
- Modify: `package.json` (add `"triggers": "bun run src/cli/triggers.ts"`)
- Test: `tests/cli/triggers.test.ts`

**Interfaces:**
- Consumes: `createTriggerStore`, `createTriggerSecretStore`, `createFireTrigger` (or a store-backed subset), `createJobStore`; `loadConfig`; the `runDaemonCli` injected-deps shape (`src/cli/daemon.ts:67`).
- Produces:

```ts
export type TriggersCliDeps = {
  list(): Trigger[];
  add(spec: TriggerInput): { trigger: Trigger; token?: string; url?: string };
  setEnabled(id: string, enabled: boolean): void;
  remove(id: string): void;
  history(id: string): TriggerFiring[];
  fire(id: string): Promise<{ jobId: string; runId: string } | { skipped: string }>;
  print: (s: string) => void;
};
export async function runTriggersCli(argv: string[], deps: TriggersCliDeps): Promise<void>;
```

  Subcommands: `list` (table of id/name/type/enabled/nextRunAt), `add '<json>'` (parse a `TriggerInput` JSON arg, print the once-only token/url for a webhook), `enable <id>`/`disable <id>` (`setEnabled`), `remove <id>`, `history <id>` (firings table), `fire <id>` (manual fire, print `{jobId,runId}`). Pure dispatch over `deps` (the `runDaemonCli` pattern) so tests assert behavior without touching the real DB. A `buildRealTriggersDeps()` builds the store/secret/fire over `jobs.db` (the `buildRealDaemon` idiom); `if (import.meta.main)` strips a leading `triggers` token and dispatches.

- [ ] **Step 1: Write the failing tests** (inject fake deps; assert dispatch):

```ts
test('triggers list prints each trigger; enable toggles; fire prints ids', async () => { /* spy deps, assert print calls */ });
test('add parses a JSON spec and prints a webhook token once', async () => { /* ... */ });
```

- [ ] **Step 2: Run tests to verify they fail** → FAIL.
- [ ] **Step 3: Write minimal implementation** per the Produces block. No `console.log` in the dispatch body — use `deps.print`; `buildRealTriggersDeps` may use `console.log` only inside the real `print` closure (the `daemon.ts` precedent).
- [ ] **Step 4: Run tests to verify they pass** → PASS.
- [ ] **Step 5: Gate + commit** — `bun run typecheck && bun run lint:file -- src/cli/triggers.ts tests/cli/triggers.test.ts`.

```bash
git add src/cli/triggers.ts package.json tests/cli/triggers.test.ts
git commit -m "feat(triggers): agent triggers CLI (list|add|enable|disable|remove|history|fire)"
```

*Model: Sonnet.*

### Task 33: Increment 7 boundary gate

- [ ] **Step 1: Run the full gate** — `bun run check`. Fully green including docs-check (Task-1 stub; no exemption).
- [ ] **Step 2: Update the SDD ledger** with the CLI commit.

*Model: controller.*

---

## Increment 8 — Docs (4 surfaces) + ledger + Artifact + live-verify + capstone + land

Closes the docs hard line, runs the mandatory §10 live-verify, the Fable whole-branch capstone, and lands the slice.

### Task 34: The four living doc surfaces + Artifact regen

**Files:**
- Modify: `docs/architecture.md`, `README.md`, `docs/ROADMAP.md`, `.superpowers/sdd/progress.md`
- Artifact: regenerate the architecture-snapshot (not a repo file)

- [ ] **Step 1: `docs/architecture.md`** — **EXPAND the `src/triggers/` stub landed in Task 1** into the full subsystem section (scheduler tick → `fire.ts` convergence → `JobStore.enqueue`; the four sources — cron/webhook/file/chain; the boot repo sync; the `triggers`/`trigger_firings` tables sharing `jobs.db` via the combined migration list). Replace the stub's "expanded later" note. Document the **`/hooks/:token` route class** (outside the `/api` session guard, inside the perimeter; token/HMAC/replay/cap/rate-limit) and the `origin` threading through `dispatch.ts`. Add the module-map + data-flow edges. Update the [doc map / README pointer] if a living doc was added (none expected). (`docs:check` has passed since Task 1 via the stub — this task is about docs TRUTH/completeness, audited by Task 36's final review against the diff, not about unblocking the gate.)
- [ ] **Step 2: `README.md`** — update the **Status line**; add the **Slice 25 row** to the slice status table (✅ Done); update the "Next" line (Slice 25 done → the next committed slice) and any feature paragraph so triggers read as shipped.
- [ ] **Step 3: `docs/ROADMAP.md`** — flip the **"Scheduled / triggered agents"** marker and the **"Triggers (webhook / schedule / event)"** gap-table row from ❌/🟡 → ✅ shipped (Slice 25); update the phase table + recommended-sequence line.
- [ ] **Step 4: SDD ledger** (`.superpowers/sdd/progress.md`) — a `SLICE 25` section with per-task commits, review verdicts, and the increment gates (the Slice-25b section is the template).
- [ ] **Step 5: Artifact** — regenerate the interactive architecture snapshot from `architecture.md`: add a `triggers` subsystem node + edges to Queue/Daemon/`/hooks`/contracts; update the footer slice count and the real test count (run the suite for the number). Validate with `node --check` + referential-integrity + the real test-count gate (the `reference-artifact-regen-mechanics` memory).
- [ ] **Step 6: Gate + commit** — `bun run docs:check && bun run check`.

```bash
git add docs/architecture.md README.md docs/ROADMAP.md .superpowers/sdd/progress.md
git commit -m "docs(triggers): architecture + README + ROADMAP + SDD ledger for Slice 25"
```

*Model: Sonnet (mechanical doc edits) — but the final whole-branch review (Task 36) audits these claims against the diff for TRUTH, not just presence.*

### Task 35: Live-verify gate (§10, mandatory before merge)

Run on the target box against the real daemon (launchd or `bun run daemon start-foreground`) + real Ollama + native `/chrome` (logged-in session). Record each result in the ledger.

- [ ] **Step 1 — Cron:** create a cron trigger in the console → observe a real fire → the job appears in the **Jobs** tab with `origin=schedule`; the runs `?origin=schedule` facet shows it.
- [ ] **Step 2 — Webhook:** `curl` the `/hooks/:token` URL with (a) a good HMAC + fresh timestamp → job fires (`202 {jobId,runId}`); (b) a bad HMAC → `401`; (c) a replayed (stale) timestamp → `409`. Confirm the secret appears in NO log line.
- [ ] **Step 3 — File:** drop a file into a watched dir → job fires with `{{file.path}}` substituted into the payload; confirm a path outside the watch root was rejected at create time.
- [ ] **Step 4 — Chain:** a two-step chain (job A `done` → job B fires); prove the depth cap halts a self-referential chain at `AGENT_TRIGGERS_MAX_CHAIN_DEPTH`.
- [ ] **Step 5 — Restart:** stop the daemon with a due cron pending, restart → **exactly ONE** catch-up fire (not one per missed interval). Verify the console firing history + the runs `?origin=` facet against each fire.
- [ ] **Step 6:** Record PASS/FAIL per step in the ledger; any defect found is fixed in-slice (no deferrals) before proceeding.

*Model: controller-driven live session (real models + browser).*

### Task 36: Fable whole-branch capstone review

- [ ] **Step 1:** Dispatch the **Fable** whole-branch adversarial review over the full `slice-25-triggers` diff (weekly-Fable headroom permitting; else Opus ultracode). Focus the four hard parts: §7.1 webhook security (constant-time compare, HMAC-over-raw-body, replay window, secret never leaks), §7.2 scheduler atomicity (no double-fire across tick races / restart), §7.3 chain-cycle guard + template-injection-is-not-eval, §7.4 file-watcher confinement. Also audit: docs claims vs the diff (truth, not presence), trusted-local on ALL mutating routes, repo-origin pause/resume-only, no secrets in logs/DTOs/spans.
- [ ] **Step 2:** Fix every finding in-slice (no deferrals). Re-run `bun run check`.
- [ ] **Step 3:** Record the verdict + any fixes in the ledger.

*Model: **Fable** (premium whole-branch capstone).*

### Task 37: Land + notify

- [ ] **Step 1:** Confirm `bun run check` green (scope-excluding any known `.live` model-nondeterminism flake, documented as in Slice-25b).
- [ ] **Step 2:** Publish the regenerated Artifact (final counts).
- [ ] **Step 3:** Merge `slice-25-triggers` → `main` with `--no-ff` and push (the four doc surfaces + ledger in the same push satisfy the pre-push slice-landing gate).
- [ ] **Step 4:** Notify the user via `PushNotification` that Slice 25 landed (headline: cron/webhook/file/chain triggers backend + live console tab + CLI), with the merge commit ref.

*Model: controller. Autonomous merge+push+notify per the standing multi-slice authorization.*

---

## Self-Review (run before handing off; fix inline)

**1. Spec coverage (every D1–D4, §7, §8, §9, §10, §11 → a task):**
- D1 trigger model + BOTH surfaces + storage → Tasks 1,3,4,5,7,14 (repo sync + enabled overlay + `jobs.db` tables + secrets file in Task 18).
- D2 poll-tick scheduler (Croner-lib, misfire fire-once, overlap skip) + module set (`scheduler/fire/watcher/chain/sync`) + daemon wiring → Tasks 9,10,12,13,14,15,16.
- D3 webhooks + provenance → Tasks 18,19,20 (+ origin column Task 4; retry preserves `origin`/`chainDepth` — Task 20, I6).
- D4 API (7 routes, trusted-local, repo rules, keyset firings, action-before-:id) + contracts (DTOs/wire enums/parity) + console + CLI → Tasks 2,3,22,23,24,25,27–30,32.
- §7.1 webhook security → Tasks 18,19 (Opus + adversarial). §7.2 scheduler atomicity → Tasks 7,10 (Opus + adversarial). §7.3 chain-cycle + template-not-eval → Tasks 9,13 (Opus + adversarial). §7.4 file confinement → Task 12 (Opus + adversarial).
- §8 arch-doc + telemetry → Task 34 (docs) + Task 8 (spans/ATTR).
- §9 testing strategy (fake-clock scheduler, HMAC accept/reject, replay 409, over-cap 413, path confinement, chain depth, DTO round-trips + wire parity) → embedded in Tasks 2,3,7,9,10,12,13,19.
- §10 live-verify (5 steps) → Task 35. §11 deps (`croner` Task 10, `chokidar@4` Task 12) + knobs (Task 8) → covered.

**2. Placeholder scan:** no "TBD"/"handle edge cases"/"similar to Task N" — every code step shows real code or a precise Produces contract; the hard-part bodies (`claimDueCron`, `createFireTrigger`, `verifyHmac`/`handleWebhook`, misfire `reconcile`, chain depth threading, `substituteTemplate`) are written in full.

**3. Type consistency:** `Trigger`/`TriggerFiring`/`TriggerInput`/`TriggerConfig` names identical across Tasks 1→7→9→15→22; `TriggerStore` method names (`claimDueCron`, `latestFiring`, `upsertRepo`, `listFirings`, `getByName`) match between Task 7 (def) and Tasks 9/10/14/22/23 (use); `FireTrigger`/`FireContext`/`FireResult` consistent between Tasks 9,10,12,13,19,24; wire enums (`TriggerTypeWire`/`TriggerOriginWire`/`TriggerOutcomeWire`) match engine enums via the Task 2 parity test; `origin`/`chainDepth` field names identical across `JobInput`/`JobRecord`/migration/store (Task 4), `fire.ts`/`chain.ts` (Tasks 9,13), AND the retry re-enqueue (Task 20, I6); `ServerDeps.triggers` (Task 16) matches the routes' `need(deps.triggers, 'triggers')` (Tasks 22–25); `TriggerSecretStore` shape matches between Task 18 (def) and Tasks 15/19/23 (use).

- **Signatures changed by the adversarial-audit fixes (verified consistent end-to-end):**
  - `computeNextRun(t, after): number | null` (Task 10) — nullability was already declared; the fix makes it *actually* non-throwing (try/catch → null). Every caller already treats `null` as "park/disable": `claimDueCron`'s injected `computeNext` (Task 7), `scheduler.tick`/`reconcile` (Task 10, reconcile disables on null — I1), `parseTriggerConfig`'s cron `create` seed (Task 23). No call site assumes a non-null return.
  - `claimDueCron` SQL (Task 7, M5) no longer writes `last_fired_at`; the ONLY writer is `fire.ts` on a `Fired` outcome (Task 9). Signature unchanged; the Task 7 test asserts `lastFiredAt` stays undefined after a bare claim.
  - Pool `onSettled?: (job, status: Done|Failed) => void` (Task 13) — signature unchanged; the I5 fix only relocates the `safeSettled(Done)` call inside the `try` (fires only on a committed `markDone`). The engine's `handleJobSettled` matches this exact shape (Task 15/16).
  - Config knobs (Task 8): `AGENT_TRIGGERS_PATH` **removed** (no consumer, M1); `AGENT_TRIGGERS_ENABLED` **added** (boolean, standalone-only gate, read at Task 16); `AGENT_TRIGGERS_WATCH_ROOT` default is now `~/.agent/inbox`. The Task 8 test and every reader (Tasks 12/15/16/23) reference only these live names.
  - `expandHome(p)` + `confineWatchPath(candidate, baseDir)` (Task 12) — the expanded root is passed identically by the watcher (Task 12) and `parseTriggerConfig` (Task 23), so a create-time-accepted file path is never watch-time-rejected.
  - `verifyHmac` (Task 19) — signature unchanged; the M4 fix pins `timestampHeader` to unix SECONDS and signs `${seconds}.${rawBody}` verbatim (both the pure test and the live-verify curl use a seconds timestamp).
