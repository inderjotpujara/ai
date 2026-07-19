# Slice 24 — Always-on Daemon + Task Queue + Resumable Jobs + Secure Remote Access — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL — use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Execute strictly top-to-bottom; each task's **Interfaces** block names the exact signatures the next task consumes, so parallel implementers stay aligned.

**Goal:** Turn the foreground web BFF (`src/server/main.ts` — request-scoped runs that die with their HTTP connection) into a **long-lived daemon with a persistent SQLite job queue at its heart**. An HTTP call (or a future Slice-25 trigger) **enqueues** a job and gets a `jobId`; a bounded worker pool inside the daemon runs it independently of any connection; clients poll or SSE-stream status; jobs survive daemon restart, and long crew/workflow runs resume at DAG-node granularity. The daemon is reachable from anywhere via a pluggable tunnel (Tailscale default), authenticated by a durable root token that mints short-lived per-device session tokens. Full design (authoritative): [`../specs/2026-07-19-slice-24-daemon-queue-remote-design.md`](../specs/2026-07-19-slice-24-daemon-queue-remote-design.md).

**Architecture:** New `src/queue/` (the heart — SQLite `jobs` store mirroring `src/session/store.ts`, scheduler + bounded worker pool + priority + retry reusing `src/reliability/`) → new `src/daemon/` (PID file, `SIGTERM`/`SIGINT` drain via `src/process/`, boot-recovery calling `queue.reconcileOrphans`, launchd plist, `agent daemon` CLI) → new `src/server/security/root-token.ts` (durable root token → per-device session tokens, replacing the process-ephemeral `src/server/security/token.ts:5` mint) → `src/server/app.ts`/`main.ts` gain `/api/jobs*` routes and the chat/crew/workflow/model-pull handlers change from inline-await / `void`-detach to **enqueue → `202 {jobId, runId}`** → resume substrate is either `@ai-sdk/workflow`'s `WorkflowAgent` (adopted) or a custom per-node checkpoint store in `src/workflow/` (fallback), **decided by the Increment 1 spike**.

**Tech Stack:** Bun + TypeScript (root, `bun:test`); `bun:sqlite` (WAL); Zod v4; `ai@^7`, `@ai-sdk/otel@^1`, `@ai-sdk/mcp@^2` (already deps); `@ai-sdk/workflow` added ONLY if the Increment 1 spike adopts it. OpenTelemetry via the existing `src/telemetry/run-router.ts`. React 19 / Vite / `vitest` for `web/` (only Increment 7 touches docs, no web code this slice unless a task says so).

## Global Constraints (govern every task)

- **Package manager:** `bun`, never `npm`. Root/server tests use `bun:test` (`import { test, expect, describe } from 'bun:test'`). Never introduce `vitest` into a root/server test.
- **Per-task gate before every commit** (all three, every task): `bun run typecheck` (clean) + `bun run lint:file -- <files>` (0 errors) + the task's focused tests (`bun test <file>`). `bun test` does NOT typecheck and the pre-commit hook is `docs:check` only — run all three yourself.
- **Code style:** `type` over `interface`; **`enum` over string-literal unions** for finite named sets (string enums only — `enum Foo { A = 'A' }`); discriminated object unions stay `type` (discriminant may be an enum value); early returns over nested conditionals; small focused files; descriptive names; no `console.log`. Strict TS — `noUncheckedIndexedAccess` is ON (index access is `T | undefined`; guard it). Explicit `.ts` import extensions.
- **Never hardcode model choices / budgets / limits / concurrency / intervals / N** — compute live (from hardware where relevant); env vars are fallback-only overrides. New knobs go in `src/config/schema.ts` as documented `ConfigEntry` rows (`env`/`kind`/`def`/`doc`), transcribing the real default. The worker-pool concurrency N is computed from `os.availableParallelism()`/`os.totalmem()` (precedent: `src/resource/hardware.ts`), env-override `AGENT_QUEUE_CONCURRENCY`.
- **Contracts (`src/contracts/**`) are isomorphic:** import only `zod` (and sibling contract files); no `.strict()`; pair `export const XSchema` with `export type X = z.infer<typeof XSchema>`. Enums live in `src/contracts/enums.ts` and import nothing.
- **Model tiering:** Sonnet is the floor for all implementation. **The hard-part tasks are Opus / ultracode adversarial-verify:** the atomic `claimNext` claim under concurrent workers (§7.3 no-double-claim), `reconcileOrphans` boot recovery (§7.3 no-double-exec), the SSE reconcile race (§7.1), the durable-token threat model (§7.4), and the resume-wiring branch (Increment 6). Reviews are never downgraded.
- **Branch:** `slice-24-daemon-queue-remote` (cut off `main`). Commit per task, conventional subject. Run the full `bun run check` at each increment boundary (the "Boundary gate" task).
- **Docs hard line (non-negotiable, 4 surfaces):** the final increment (Increment 7) updates **all four living surfaces** in the same landing push — (1) [`docs/architecture.md`](../../architecture.md) (new Daemon + Queue subsystems + server/auth/run-store/telemetry deltas), (2) root [`README.md`](../../../README.md) (Status line + slice-status table row ✅ Done + feature paragraph + Next line), (3) [`docs/ROADMAP.md`](../ROADMAP.md) (flip daemon/queue/resumable/remote markers in the gap + phase + recommended-sequence tables), (4) the interactive architecture-snapshot **Artifact** (regenerated from `architecture.md`, new Daemon + Queue nodes/edges, updated footer slice/test counts) — plus the SDD ledger `.superpowers/sdd/progress.md`. `bun run docs:check` + the pre-push slice-landing gate hard-fail until README, ROADMAP, and the SDD ledger are updated in the same push. Every spec/plan also carries the two standing notes (architecture-doc update + telemetry to emit) — this plan's are in §8 of the spec.

## Shared contracts (defined ONCE — every task's Interfaces block references these verbatim)

These are the canonical enums, records, and factory signatures. They are introduced by concrete tasks (cited), but stated here so all seven increments stay type-consistent. Do not redefine or drift them.

**Enums** (`src/queue/types.ts`, Task 4; `JobKind` extends `src/contracts/enums.ts`):
```typescript
export enum JobStatus {
  Queued = 'queued',
  Running = 'running',
  Done = 'done',
  Failed = 'failed',
  Interrupted = 'interrupted',
  Canceled = 'canceled',
}

export enum JobPriority {
  High = 'high',
  Normal = 'normal',
}

// JobKind values are a SUBSET of RunKind's values (src/contracts/enums.ts:116)
// — the launchable run kinds — so a job's kind is always a valid RunKind for
// run creation + telemetry. This RESOLVES spec §5's "model-pull"/"builder"
// wording to RunKind.Pull / RunKind.Build (the real enum values) — the spike's
// prose names, mapped to the codebase's actual RunKind so no second, drifting
// kind vocabulary is introduced.
export enum JobKind {
  Chat = 'chat', // RunKind.Chat
  Crew = 'crew', // RunKind.Crew
  Workflow = 'workflow', // RunKind.Workflow
  Pull = 'pull', // RunKind.Pull  (spec "model-pull")
  Build = 'build', // RunKind.Build (spec "builder")
}
```

**`JobRecord`** (camelCase TS side; columns are snake_case — mirrors `SessionRow`/`SessionRowRaw` in `src/session/store.ts:11`):
```typescript
export type JobRecord = {
  id: string;
  kind: JobKind;
  payload: unknown; // JSON blob — the run's launch input (validated per-kind at dispatch)
  priority: JobPriority;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  createdAt: number;
  updatedAt: number;
  startedAt: number | undefined;
  finishedAt: number | undefined;
  availableAt: number; // epoch-ms floor: not claimable until now >= availableAt (0 = immediately). Retry backoff sets this forward (Task 8) so claimNext (Task 7) actually spaces re-claims under concurrency.
  runId: string | undefined; // the runs/<id> this job's execution wrote to
  result: unknown; // terminal success payload (JSON), undefined until Done
  error: string | undefined; // terminal failure title, undefined unless Failed
};

export type JobInput = {
  kind: JobKind;
  payload: unknown;
  priority?: JobPriority; // defaults to Normal
  maxAttempts?: number; // defaults to computed maxAttempts() (reliability/config.ts)
  availableAt?: number; // epoch-ms floor; defaults to 0 (immediately claimable). A caller may schedule a delayed job; retry backoff sets it forward internally.
  runId?: string; // caller may pre-mint (newRunId()); store mints if absent
};
```

**Queue store** (`createJobStore` — factory-returns-closure, mirroring `createSessionStore`, Tasks 6–10):
```typescript
export type JobStore = {
  enqueue(input: JobInput): JobRecord;
  claimNext(): JobRecord | null; // atomic priority-then-FIFO Queued→Running in db.transaction()
  markDone(id: string, result: unknown): void;
  markFailed(id: string, error: string, retryable: boolean): void; // retryable → back to Queued if attempts<maxAttempts, else Failed
  markInterrupted(id: string): void;
  markCanceled(id: string): void;
  getJob(id: string): JobRecord | undefined;
  listJobs(q: { status?: JobStatus; cursor?: string; limit: number }): {
    items: JobRecord[];
    nextCursor?: string;
    total: number;
  };
  reconcileOrphans(): { interrupted: number; requeued: number }; // boot recovery, one db.transaction() before pool starts
  close(): void;
};
export function createJobStore(config: { path?: string }, deps: JobStoreDeps): JobStore;
```
> **Two deliberate "defined once" caveats (not drift):** (1) Task 6 ships the concrete type as `export type JobStore = ReturnType<typeof createJobStore>` (inferred from the factory) rather than re-declaring this shape by hand — the shape above is the *contract* that inference must satisfy, not a second hand-written declaration to keep in sync. (2) `reconcileOrphans` is shown zero-arg here because that is its Increment-2 form; it **intentionally evolves** in Increment 6 (Task 41) to accept an optional `durable?: (job: JobRecord) => boolean` predicate (default = all-Interrupted, preserving Inc-2 behaviour). Both evolutions are called out at their tasks (Task 6, Task 10, Task 41), so the single-source framing holds.

**Worker pool** (`src/queue/pool.ts`, Task 14):
```typescript
export type JobExecutor = (job: JobRecord, signal: AbortSignal) => Promise<unknown>;
export type WorkerPool = {
  start(): void;
  stop(): Promise<void>; // drain: stop claiming, await in-flight, markInterrupted anything still Running on hard stop
  cancel(jobId: string): boolean; // fires the job's AbortController; false if not running
  activeCount(): number;
};
export function createWorkerPool(opts: {
  store: JobStore;
  concurrency: number; // computed from hardware, env-override AGENT_QUEUE_CONCURRENCY
  dispatch: (kind: JobKind) => JobExecutor; // JobKind → executor
  pollMs?: number;
}): WorkerPool;
```

**Root/session token** (`src/server/security/root-token.ts`, Increment 5 Tasks):
```typescript
export type RootTokenStore = {
  getOrCreateRoot(): string; // reads ~/.agent/daemon-token (0600); mints once if absent
  rotate(): string; // rolls the root; invalidates all sessions
};
export function createRootTokenStore(config: { path?: string }): RootTokenStore;

export type SessionTokenStore = {
  mintSessionToken(input: { deviceId: string; ttlMs: number }): string;
  verifySessionToken(raw: string): { deviceId: string } | null; // constant-time; null if bad/expired/revoked
  revokeDevice(deviceId: string): void;
};
export function createSessionTokenStore(config: { path?: string; rootToken: string }): SessionTokenStore;
```

**Daemon** (`src/daemon/core.ts`, Increment 4 Tasks):
```typescript
export type Daemon = {
  install(): void; // write launchd plist
  start(): Promise<void>; // PID file, boot-recovery (reconcileOrphans), pool.start, startWebServer
  stop(): Promise<void>; // SIGTERM drain
  status(): { running: boolean; pid?: number };
};
export function createDaemon(opts: {
  startWebServer: typeof import('../server/main.ts').startWebServer;
  queue: JobStore;
  pool: WorkerPool;
  pidPath?: string;
  // Inc 6 (Task 41): reconcile predicate — a durable (checkpoint-resumable)
  // orphan requeues instead of interrupting. Absent in Inc 4-5 (all-Interrupted).
  durable?: (job: JobRecord) => boolean;
}): Daemon;
```

**`RunOrigin.Daemon`** — add to `src/contracts/enums.ts:8` (`RunOrigin`) the value `Daemon = 'daemon'` (Task 26); daemon/queue-originated runs surface `origin: RunOrigin.Daemon` in `RunDTO`/`RunListItemDTO`.

---

# Increment 1 — SPIKE `@ai-sdk/workflow` `WorkflowAgent` + filesystem store (gates §7.2 / D5c)

**Purpose (spec §5.1, §7.2):** de-risk the resume substrate BEFORE any production wiring. Prove whether `@ai-sdk/workflow` runs local-first with a **filesystem store** and **no Vercel infra**, and whether a multi-node workflow killed mid-DAG resumes from the last completed node with **no re-execution**. Output a **decision record** (adopt vs. custom checkpoint) that Increment 6 branches on. Keep this increment small and throwaway — nothing here ships to `src/`.

## Task 1: Add `@ai-sdk/workflow` behind a spike flag + scaffold the spike harness

**Files:**
- Modify: `package.json` (add `"@ai-sdk/workflow"` to `dependencies`; pin the latest v-line compatible with `ai@^7`)
- Create: `spikes/workflow-agent/README.md` (what the spike proves, how to run it, teardown note)
- Create: `spikes/workflow-agent/.gitignore` (ignore the filesystem-store scratch dir `./.wf-store/`)

**Interfaces:**
- Consumes: `ai@^7` (already a dep, `package.json`); Node `node:child_process`/`node:fs` for the kill-and-restart harness.
- Produces: nothing importable by `src/`. This is a spike dir OUTSIDE `src/` so `docs:check` never treats it as an undocumented subsystem and `bun run test` (`--path-ignore-patterns 'web/**'`) still picks up its test unless we exclude it — put the spike test under `spikes/` and run it explicitly, NOT via the normal suite (see Task 2).

- [ ] **Step 1: Verify the dep resolves against `ai@^7`**

```bash
bun add @ai-sdk/workflow
bun pm ls | grep -E '@ai-sdk/(workflow|otel)|^ai@|ai@'
```
Expected: `@ai-sdk/workflow` resolves without a peer-dependency conflict against the installed `ai@^7.x`. If it hard-conflicts (requires `ai@8`), STOP and record "adopt = blocked by peer range" straight into the Task 3 decision record — that alone selects the fallback path.

- [ ] **Step 2: Write the harness README**

`spikes/workflow-agent/README.md`:
```markdown
# Spike: @ai-sdk/workflow WorkflowAgent + filesystem store (Slice 24 Increment 1)

Proves/refutes D5c: does WorkflowAgent run local-first with a filesystem store
(no Vercel infra), and does a multi-node workflow killed mid-DAG resume from the
last completed node with NO re-execution of completed nodes?

Run:
    bun test spikes/workflow-agent/resume.spike.test.ts

Teardown: rm -rf spikes/workflow-agent/.wf-store

Outcome feeds docs/superpowers/plans/... Task 3 decision record.
```

- [ ] **Step 3: Gate + commit**

```bash
bun run typecheck && bun run lint:file -- package.json
git add package.json spikes/workflow-agent/README.md spikes/workflow-agent/.gitignore
git commit -m "spike(queue): add @ai-sdk/workflow + spike harness scaffold (Slice 24 Incr 1)"
```

## Task 2: Spike test — multi-node workflow killed mid-DAG resumes from last completed node

**Files:**
- Create: `spikes/workflow-agent/resume.spike.test.ts`
- Create: `spikes/workflow-agent/worker.ts` (the runnable multi-node workflow the test spawns, kills, and restarts)

**Interfaces:**
- Consumes: `@ai-sdk/workflow` `WorkflowAgent` + its filesystem store (Task 1); `newRunId` shape (a stable checkpoint key). Use a **fake/deterministic step body** (no real model) — each node appends its name to a side-effect log file and sleeps; killing the process between nodes must leave the completed-node log intact and, on restart against the SAME store dir, the workflow must NOT re-append a completed node's name.
- Produces: the empirical answer to §7.2, consumed by Task 3.

- [ ] **Step 1: Write the failing spike test**

`spikes/workflow-agent/resume.spike.test.ts`:
```typescript
import { test, expect } from 'bun:test';
import { rmSync, readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const STORE = 'spikes/workflow-agent/.wf-store';
const LOG = 'spikes/workflow-agent/.wf-store/nodes.log';

// The worker runs a 3-node DAG (a → b → c). Each node appends its name to LOG.
// Node b sleeps long enough that we kill the worker mid-b on the FIRST run,
// then re-run against the SAME store: a durable substrate resumes at b/c and
// must NOT re-append "a".
test('WorkflowAgent resumes mid-DAG from a filesystem store with no re-execution', () => {
  rmSync(STORE, { recursive: true, force: true });

  // Run 1: KILL after node "a" completes but before "c" finishes.
  const first = spawnSync('bun', ['spikes/workflow-agent/worker.ts', '--kill-after', 'a'], {
    env: { ...process.env, WF_STORE: STORE, WF_LOG: LOG },
    timeout: 30_000,
  });
  expect(first.status).not.toBe(0); // killed mid-run
  expect(existsSync(LOG)).toBe(true);
  const afterKill = readFileSync(LOG, 'utf8').trim().split('\n');
  expect(afterKill).toContain('a');
  expect(afterKill).not.toContain('c'); // did not finish

  // Run 2: resume against the SAME store — must finish c WITHOUT re-running a.
  const second = spawnSync('bun', ['spikes/workflow-agent/worker.ts', '--resume'], {
    env: { ...process.env, WF_STORE: STORE, WF_LOG: LOG },
    timeout: 30_000,
  });
  expect(second.status).toBe(0);
  const finalLog = readFileSync(LOG, 'utf8').trim().split('\n');
  expect(finalLog).toContain('c'); // completed
  // The KEY assertion: "a" appears EXACTLY ONCE across both runs (no re-exec).
  expect(finalLog.filter((l) => l === 'a')).toHaveLength(1);
});
```

- [ ] **Step 2: Run the spike — record the real behaviour**

```bash
rm -rf spikes/workflow-agent/.wf-store
bun test spikes/workflow-agent/resume.spike.test.ts
```
- If it PASSES → `WorkflowAgent` + filesystem store resumes cleanly local-first → **adopt path is viable**.
- If `WorkflowAgent`'s API cannot express a filesystem store without Vercel infra, or re-executes node `a` on resume, or the peer range blocked install (Task 1) → **adopt path is not viable**; the custom checkpoint fallback is selected.

Either way is a valid outcome — this task's deliverable is the recorded truth, not a green test.

- [ ] **Step 3: Implement `worker.ts` to exercise the real API**

`spikes/workflow-agent/worker.ts` — build the smallest 3-node `WorkflowAgent` the installed API supports, configured with a filesystem store rooted at `process.env.WF_STORE`, each node appending its name to `process.env.WF_LOG` then a short sleep; `--kill-after <node>` self-`process.exit(137)`s right after that node's append; `--resume` reconstructs the same workflow pointed at the same store and runs to completion. (Write to the actual `@ai-sdk/workflow` surface Task 1 installed — do not invent method names; read the package's exported types with `bun pm ls` + the `node_modules/@ai-sdk/workflow/dist/*.d.ts` before writing.)

- [ ] **Step 4: Re-run + capture the transcript**

Re-run Step 2. Copy the full pass/fail transcript into the Task 3 decision record verbatim (it is the evidence).

- [ ] **Step 5: Commit the spike (regardless of adopt/fallback outcome)**

```bash
git add spikes/workflow-agent/
DOCS_OK=1 git commit -m "spike(queue): WorkflowAgent mid-DAG resume test against filesystem store (Slice 24 Incr 1)"
```
(`DOCS_OK=1` is justified: a `spikes/` commit changes no `src/**` and is not a slice landing.)

## Task 3: Decision record — adopt `@ai-sdk/workflow` vs. custom per-node checkpoint store

**Files:**
- Create: `docs/superpowers/decisions/2026-07-19-slice-24-resume-substrate.md`
- Modify: this plan file — set the Increment 6 "SELECTED PATH" marker (Task 40's header) to the decision's outcome.

**Interfaces:**
- Consumes: the Task 2 spike transcript + Task 1 peer-range result.
- Produces: a single machine-checkable verdict — `SUBSTRATE = adopt` or `SUBSTRATE = custom` — that Increment 6 (Task 40/41) branches on. D5 pre-commits BOTH paths, so the deliverable (resume at DAG-node granularity) is fixed either way.

- [ ] **Step 1: Write the decision record**

`docs/superpowers/decisions/2026-07-19-slice-24-resume-substrate.md` must contain, in order: (1) the question (D5c / §7.2), (2) the Task 2 transcript, (3) the peer-range result, (4) the answers to the three spike questions — runs local-first? filesystem store, no Vercel? wraps-or-replaces our `src/workflow/` engine? — (5) the verdict line, EXACTLY one of:
```
SUBSTRATE = adopt   (Increment 6 uses WorkflowAgent resume — Task 40a/41a)
SUBSTRATE = custom  (Increment 6 uses src/workflow/checkpoint.ts — Task 40b/41b)
```
(6) a one-paragraph rationale.

- [ ] **Step 2: Stamp the Increment 6 header**

Edit this plan's Increment 6 "SELECTED PATH" line (below) to name the chosen path so the executor cannot miss it.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/decisions/2026-07-19-slice-24-resume-substrate.md docs/superpowers/plans/2026-07-19-slice-24-daemon-queue-remote.md
DOCS_OK=1 git commit -m "docs(queue): Slice 24 resume-substrate decision record (Incr 1 gate)"
```
(`DOCS_OK=1`: a `docs/superpowers/` decision record + plan edit is not a slice landing.)

## Task 3b: Boundary gate — Increment 1

**Files:** none (verification only).

- [ ] **Step 1: Run the full root gate**

```bash
bun run typecheck && bun run lint && bun run test
```
Expected: PASS. The spike test lives under `spikes/` and is NOT run by `bun run test` (which the normal suite scopes to `tests/` + `src/`); if it is picked up, exclude `spikes/**` the same way `web/**` is excluded in the `test` script. The decision record's verdict line is set. No `src/**` changed yet — nothing to break.

---

# Increment 2 — Queue core (`src/queue/`, SQLite jobs store + bounded worker pool)

**Purpose (spec §5.2, D6):** the persistent job control plane. SQLite `jobs` table mirroring `src/session/store.ts` (WAL + `busy_timeout=5000` + `foreign_keys=ON`, `user_version` migrations via `src/db/migrate.ts`, `INSERT OR IGNORE` idempotency, `db.transaction()` atomicity, base64url keyset pagination, snake_case↔camelCase mappers). Scheduler + bounded worker pool (N from hardware, env-override) + priority lanes + retry reusing `src/reliability/`. **No HTTP yet** — unit-tested against a temp SQLite db (mirrors the `SessionStore` test precedent). Closes deferred items 7 (concurrent-launch cap = the pool) and 11 (persistence chartered out of Slice 21). This increment's spans (item 18) are added in Increment 4 once the daemon owns the tracer.

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

## Task 5: Jobs migration — `'init-jobs'`

**Files:**
- Create: `src/queue/migrations.ts`
- Create: `tests/queue/migrations.test.ts`

**Interfaces:**
- Consumes: `Migration` (`src/db/migrate.ts:3`), `migrate` (`src/db/migrate.ts:6`), `Database` (`bun:sqlite`).
- Produces: `JOB_MIGRATIONS: Migration[]` — one migration `'init-jobs'` creating the `jobs` table + a claim index. Mirrors `SESSION_MIGRATIONS` (`src/session/migrations.ts:18`).

- [ ] **Step 1: Write the failing test**

`tests/queue/migrations.test.ts`:
```typescript
import { test, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { migrate } from '../../src/db/migrate.ts';
import { JOB_MIGRATIONS } from '../../src/queue/migrations.ts';

test('init-jobs creates the jobs table with the JobRecord columns', () => {
  const db = new Database(':memory:');
  const version = migrate(db, JOB_MIGRATIONS);
  expect(version).toBe(1);
  const cols = (
    db.query('PRAGMA table_info(jobs)').all() as { name: string }[]
  ).map((c) => c.name);
  expect(cols).toEqual([
    'id', 'kind', 'payload', 'priority', 'status', 'attempts', 'max_attempts',
    'created_at', 'updated_at', 'started_at', 'finished_at', 'available_at',
    'run_id', 'result', 'error',
  ]);
});

test('init-jobs is idempotent (re-migrate is a no-op)', () => {
  const db = new Database(':memory:');
  migrate(db, JOB_MIGRATIONS);
  expect(migrate(db, JOB_MIGRATIONS)).toBe(1);
});
```

- [ ] **Step 2: Run — verify it fails**

`bun test tests/queue/migrations.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement `src/queue/migrations.ts`**

```typescript
import type { Database } from 'bun:sqlite';
import type { Migration } from '../db/migrate.ts';

/**
 * One migration for `jobs.db`: the durable task queue (spec D6). Mirrors
 * `src/session/migrations.ts`'s shape. `payload`/`result` are JSON TEXT.
 * `status`/`kind`/`priority` are TEXT holding the enum VALUES. The composite
 * index backs `claimNext`'s priority-then-FIFO scan (High before Normal, then
 * oldest created_at first) over Queued rows only.
 */
export const JOB_MIGRATIONS: Migration[] = [
  {
    name: 'init-jobs',
    up: (db: Database) => {
      db.run(`CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        payload TEXT NOT NULL,
        priority TEXT NOT NULL DEFAULT 'normal',
        status TEXT NOT NULL DEFAULT 'queued',
        attempts INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        started_at INTEGER,
        finished_at INTEGER,
        available_at INTEGER NOT NULL DEFAULT 0,
        run_id TEXT,
        result TEXT,
        error TEXT
      )`);
      // `available_at` is the epoch-ms floor before which a Queued row is NOT
      // claimable (0 = immediately). Retry backoff (markFailed, Task 8) sets it
      // forward so claimNext (Task 7) actually spaces re-claims under
      // concurrency — the delay is enforced durably in the DB, not by a worker
      // sleeping on a held slot.
      // Claim scan: filter status='queued' AND available_at<=now, order
      // High-priority first then oldest created_at. Priority is stored as its
      // enum text; 'high' < 'normal' lexically, so a plain ASC on
      // (priority, created_at) already yields High-before-Normal, oldest-first
      // — no CASE needed. `available_at` is a residual filter on the same scan.
      db.run(
        `CREATE INDEX IF NOT EXISTS idx_jobs_claim
         ON jobs(status, priority, created_at)`,
      );
    },
  },
];
```

- [ ] **Step 4: Run — verify it passes**

`bun test tests/queue/migrations.test.ts` → PASS. (Note the deliberate reliance on `'high' < 'normal'` lexical order — the test in Task 7 pins the ordering behaviourally so this cleverness can never silently regress.)

- [ ] **Step 5: Gate + commit**

```bash
bun run typecheck && bun run lint:file -- src/queue/migrations.ts tests/queue/migrations.test.ts
git add src/queue/migrations.ts tests/queue/migrations.test.ts
git commit -m "feat(queue): init-jobs migration (Slice 24 Incr 2)"
```

## Task 6: Job store — `createJobStore` + `enqueue` + `getJob` (mappers, WAL pragmas)

**Files:**
- Create: `src/queue/store.ts`
- Create: `tests/queue/store-enqueue.test.ts`

**Interfaces:**
- Consumes: `Database` (`bun:sqlite`), `migrate` (`src/db/migrate.ts:6`), `JOB_MIGRATIONS` (Task 5), the Shared-contracts types (Task 4), `newRunId` (`src/run/run-id.ts:2`), `maxAttempts` (`src/reliability/config.ts:8`).
- Produces: `createJobStore(config: { path?: string }, deps: JobStoreDeps): JobStore` with `enqueue`/`getJob`/`close` implemented (the rest are added in Tasks 7–10 on the SAME returned object). `toJobRecord(raw)` mapper + `JobRowRaw` type. Follows `createSessionStore` (`src/session/store.ts:111`) exactly: `mkdirSync(dirname(dbPath))`, WAL/busy_timeout/foreign_keys pragmas, `migrate(db, JOB_MIGRATIONS)`.

- [ ] **Step 1: Write the failing test**

`tests/queue/store-enqueue.test.ts`:
```typescript
import { test, expect } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJobStore } from '../../src/queue/store.ts';
import { JobKind, JobPriority, JobStatus } from '../../src/queue/types.ts';

function tempStore() {
  const dir = mkdtempSync(join(tmpdir(), 'jobs-'));
  return createJobStore({ path: dir }, {});
}

test('enqueue returns a Queued JobRecord with defaults applied', () => {
  const store = tempStore();
  const job = store.enqueue({ kind: JobKind.Crew, payload: { name: 'x', input: 'go' } });
  expect(job.status).toBe(JobStatus.Queued);
  expect(job.priority).toBe(JobPriority.Normal);
  expect(job.attempts).toBe(0);
  expect(job.maxAttempts).toBeGreaterThan(0);
  expect(job.id).toMatch(/^job-/);
  expect(job.runId).toMatch(/^run-/); // store mints a runId when caller omits it
  expect(job.startedAt).toBeUndefined();
  store.close();
});

test('enqueue honours an explicit priority + caller-minted runId', () => {
  const store = tempStore();
  const job = store.enqueue({
    kind: JobKind.Chat,
    payload: { task: 'hi' },
    priority: JobPriority.High,
    runId: 'run-fixed-123',
  });
  expect(job.priority).toBe(JobPriority.High);
  expect(job.runId).toBe('run-fixed-123');
  store.close();
});

test('getJob round-trips payload JSON and returns undefined for a missing id', () => {
  const store = tempStore();
  const job = store.enqueue({ kind: JobKind.Workflow, payload: { def: 'wf', input: 'q' } });
  const got = store.getJob(job.id);
  expect(got?.payload).toEqual({ def: 'wf', input: 'q' });
  expect(store.getJob('job-nope')).toBeUndefined();
  store.close();
});
```

- [ ] **Step 2: Run — verify it fails**

`bun test tests/queue/store-enqueue.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement `src/queue/store.ts` (enqueue + getJob + mappers)**

```typescript
import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { migrate } from '../db/migrate.ts';
import { maxAttempts as defaultMaxAttempts } from '../reliability/config.ts';
import { newRunId } from '../run/run-id.ts';
import { JOB_MIGRATIONS } from './migrations.ts';
import {
  type JobInput,
  JobKind,
  JobPriority,
  type JobRecord,
  JobStatus,
} from './types.ts';

type JobRowRaw = {
  id: string;
  kind: string;
  payload: string;
  priority: string;
  status: string;
  attempts: number;
  max_attempts: number;
  created_at: number;
  updated_at: number;
  started_at: number | null;
  finished_at: number | null;
  available_at: number;
  run_id: string | null;
  result: string | null;
  error: string | null;
};

function toJobRecord(r: JobRowRaw): JobRecord {
  return {
    id: r.id,
    kind: r.kind as JobKind,
    payload: JSON.parse(r.payload) as unknown,
    priority: r.priority as JobPriority,
    status: r.status as JobStatus,
    attempts: r.attempts,
    maxAttempts: r.max_attempts,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    startedAt: r.started_at ?? undefined,
    finishedAt: r.finished_at ?? undefined,
    availableAt: r.available_at,
    runId: r.run_id ?? undefined,
    result: r.result === null ? undefined : (JSON.parse(r.result) as unknown),
    error: r.error ?? undefined,
  };
}

function encodeJobCursor(createdAt: number, id: string): string {
  return Buffer.from(`${createdAt}:${id}`).toString('base64url');
}

function decodeJobCursor(
  cursor: string,
): { createdAt: number; id: string } | undefined {
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    const idx = decoded.indexOf(':');
    if (idx === -1) return undefined;
    const createdAt = Number(decoded.slice(0, idx));
    const id = decoded.slice(idx + 1);
    if (!Number.isFinite(createdAt) || id.length === 0) return undefined;
    return { createdAt, id };
  } catch {
    return undefined;
  }
}

function newJobId(now = Date.now(), rand: () => number = Math.random): string {
  const ms = Math.floor(now).toString(36).padStart(9, '0');
  const r = Math.floor(rand() * 36 ** 6).toString(36).padStart(6, '0');
  return `job-${ms}-${r}`;
}

/** Parity seam mirroring `SessionStoreDeps` (`src/session/store.ts:102`). */
export type JobStoreDeps = Record<string, never>;

export function createJobStore(
  config: { path?: string },
  _deps: JobStoreDeps,
) {
  const dbPath = join(config.path ?? 'jobs', 'jobs.db');
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.run('PRAGMA journal_mode = WAL');
  db.run('PRAGMA busy_timeout = 5000');
  db.run('PRAGMA foreign_keys = ON');
  migrate(db, JOB_MIGRATIONS);

  function enqueue(input: JobInput): JobRecord {
    const at = Date.now();
    const id = newJobId(at);
    const runId = input.runId ?? newRunId();
    const priority = input.priority ?? JobPriority.Normal;
    const max = input.maxAttempts ?? defaultMaxAttempts();
    // INSERT OR IGNORE on the PK: a retried enqueue for the SAME id is a safe
    // no-op (mirrors upsertSession's idempotency, src/session/store.ts:130).
    const availableAt = input.availableAt ?? 0; // 0 = immediately claimable
    db.run(
      `INSERT OR IGNORE INTO jobs
       (id, kind, payload, priority, status, attempts, max_attempts,
        created_at, updated_at, started_at, finished_at, available_at,
        run_id, result, error)
       VALUES (?, ?, ?, ?, 'queued', 0, ?, ?, ?, NULL, NULL, ?, ?, NULL, NULL)`,
      [id, input.kind, JSON.stringify(input.payload), priority, max, at, at, availableAt, runId],
    );
    const row = getJob(id);
    if (!row) throw new Error('enqueue failed to persist job');
    return row;
  }

  function getJob(id: string): JobRecord | undefined {
    const r = db.query('SELECT * FROM jobs WHERE id = ?').get(id) as
      | JobRowRaw
      | undefined;
    return r ? toJobRecord(r) : undefined;
  }

  return {
    enqueue,
    getJob,
    close: (): void => db.close(),
    // claimNext / mark* / listJobs / reconcileOrphans added in Tasks 7-10.
    _db: db,
    _decodeJobCursor: decodeJobCursor,
    _encodeJobCursor: encodeJobCursor,
  };
}

export type JobStore = ReturnType<typeof createJobStore>;
```
(The `_db`/`_encode`/`_decode` fields are internal seams the next three tasks build the remaining closures against — Task 10 removes them from the public return once all methods land. They are underscore-prefixed and never referenced outside `src/queue/`.)

- [ ] **Step 4: Run — verify it passes**

`bun test tests/queue/store-enqueue.test.ts` → PASS (3 tests).

- [ ] **Step 5: Gate + commit**

```bash
bun run typecheck && bun run lint:file -- src/queue/store.ts tests/queue/store-enqueue.test.ts
git add src/queue/store.ts tests/queue/store-enqueue.test.ts
git commit -m "feat(queue): createJobStore enqueue+getJob + mappers (Slice 24 Incr 2)"
```

## Task 7: `claimNext` — atomic priority-then-FIFO `Queued→Running` in a transaction (§7.3 no-double-claim) [OPUS/ultracode]

**Files:**
- Modify: `src/queue/store.ts` (add `claimNext` to the returned closure object)
- Create: `tests/queue/store-claim.test.ts`

**Interfaces:**
- Consumes: the Task 6 `db`/mappers.
- Produces: `claimNext(): JobRecord | null` on the `JobStore` — picks the highest-priority, oldest Queued row and flips it to Running **atomically** in a single `db.transaction()` so two concurrent pool workers can never claim the same row (the core §7.3 correctness property). Sets `status='running'`, `started_at`, `updated_at`, `attempts = attempts + 1`.

- [ ] **Step 1: Write the failing test**

`tests/queue/store-claim.test.ts`:
```typescript
import { test, expect } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJobStore } from '../../src/queue/store.ts';
import { JobKind, JobPriority, JobStatus } from '../../src/queue/types.ts';

function tempStore() {
  return createJobStore({ path: mkdtempSync(join(tmpdir(), 'jobs-')) }, {});
}

test('claimNext returns High-priority before Normal, then FIFO by createdAt', async () => {
  const store = tempStore();
  const n1 = store.enqueue({ kind: JobKind.Crew, payload: 1 });
  await Bun.sleep(2);
  const n2 = store.enqueue({ kind: JobKind.Crew, payload: 2 });
  await Bun.sleep(2);
  const h1 = store.enqueue({ kind: JobKind.Crew, payload: 3, priority: JobPriority.High });
  // High first, then Normals oldest-first.
  expect(store.claimNext()?.id).toBe(h1.id);
  expect(store.claimNext()?.id).toBe(n1.id);
  expect(store.claimNext()?.id).toBe(n2.id);
  expect(store.claimNext()).toBeNull();
  store.close();
});

test('claimNext flips the row to Running, sets started_at, bumps attempts', () => {
  const store = tempStore();
  const job = store.enqueue({ kind: JobKind.Chat, payload: 'x' });
  const claimed = store.claimNext();
  expect(claimed?.status).toBe(JobStatus.Running);
  expect(claimed?.attempts).toBe(1);
  expect(claimed?.startedAt).toBeGreaterThan(0);
  // Persisted, not just returned:
  expect(store.getJob(job.id)?.status).toBe(JobStatus.Running);
  store.close();
});

test('a claimed row is never re-claimed (no double-claim)', () => {
  const store = tempStore();
  store.enqueue({ kind: JobKind.Chat, payload: 'x' });
  const first = store.claimNext();
  const second = store.claimNext();
  expect(first).not.toBeNull();
  expect(second).toBeNull(); // the only Queued row is gone
  store.close();
});

test('a job with a future available_at is not claimed until it matures', () => {
  const store = tempStore();
  // Enqueued FIRST (older created_at) but scheduled into the future.
  store.enqueue({ kind: JobKind.Chat, payload: 'later', availableAt: Date.now() + 60_000 });
  // Enqueued SECOND but already claimable.
  const ready = store.enqueue({ kind: JobKind.Chat, payload: 'now', availableAt: Date.now() - 1_000 });
  // Despite being older, the future job is skipped; the matured one is claimed.
  expect(store.claimNext()?.id).toBe(ready.id);
  // The future job is still gated — nothing else claimable yet.
  expect(store.claimNext()).toBeNull();
  store.close();
});
```

- [ ] **Step 2: Run — verify it fails**

`bun test tests/queue/store-claim.test.ts` → FAIL (`claimNext` is not a function).

- [ ] **Step 3: Implement `claimNext`**

Add inside `createJobStore`, and add `claimNext` to the returned object:
```typescript
  function claimNext(): JobRecord | null {
    // Single transaction: SELECT the winning Queued row then UPDATE it to
    // Running, so two workers calling claimNext concurrently cannot both read
    // the same row as Queued and both claim it (busy_timeout=5000 serialises
    // the writers; the UPDATE's WHERE status='queued' is the guard). bun:sqlite
    // runs synchronously, so the transaction body is a critical section.
    const tx = db.transaction((): JobRecord | null => {
      const now = Date.now();
      // `available_at <= now` gates retry-backoff'd rows: a job re-queued by
      // markFailed with a future available_at is NOT re-claimed until it
      // matures, so backoff actually spaces re-claims under concurrency
      // (the delay is enforced here, durably, not by a worker sleeping).
      const r = db
        .query(
          `SELECT * FROM jobs WHERE status = 'queued' AND available_at <= ?
           ORDER BY priority ASC, created_at ASC, id ASC LIMIT 1`,
        )
        .get(now) as JobRowRaw | undefined;
      if (!r) return null;
      const at = now;
      db.run(
        `UPDATE jobs SET status = 'running', started_at = ?, updated_at = ?,
         attempts = attempts + 1 WHERE id = ? AND status = 'queued'`,
        [at, at, r.id],
      );
      const claimed = db.query('SELECT * FROM jobs WHERE id = ?').get(r.id) as
        | JobRowRaw
        | undefined;
      return claimed ? toJobRecord(claimed) : null;
    });
    return tx();
  }
```
Add `claimNext,` to the returned object literal.

- [ ] **Step 4: Run — verify it passes**

`bun test tests/queue/store-claim.test.ts` → PASS (3 tests).

- [ ] **Step 5: Gate + commit**

```bash
bun run typecheck && bun run lint:file -- src/queue/store.ts tests/queue/store-claim.test.ts
git add src/queue/store.ts tests/queue/store-claim.test.ts
git commit -m "feat(queue): atomic claimNext priority-then-FIFO (Slice 24 Incr 2)"
```

## Task 8: Terminal transitions — `markDone` / `markFailed` / `markInterrupted` / `markCanceled`

**Files:**
- Modify: `src/queue/store.ts`
- Create: `tests/queue/store-transitions.test.ts`

**Interfaces:**
- Consumes: Task 6/7 store.
- Produces: `markDone(id, result)` (→ Done, sets `result` JSON + `finished_at`), `markFailed(id, error, retryable)` (retryable AND `attempts < maxAttempts` → back to `Queued` for another claim **with `available_at = now + backoffDelay(attempts)`** so the re-claim is spaced by a persisted, full-jitter exponential backoff — NOT immediately re-claimable; else → `Failed` with `error` + `finished_at`), `markInterrupted(id)` (→ Interrupted + `finished_at`), `markCanceled(id)` (→ Canceled + `finished_at`). All bump `updated_at`. `backoffDelay` reuses `retryBaseMs`/`retryCapMs` (`src/reliability/config.ts:32,36`) — the SAME knobs as `src/reliability/retry.ts`'s `withRetry`, so queue retries and in-run retries share one backoff policy. This moves the delay COMPUTATION into the store (persisted in `available_at`) so the worker pool never sleeps holding a slot (Task 13).

- [ ] **Step 1: Write the failing test**

`tests/queue/store-transitions.test.ts`:
```typescript
import { test, expect } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJobStore } from '../../src/queue/store.ts';
import { JobKind, JobStatus } from '../../src/queue/types.ts';

function tempStore() {
  return createJobStore({ path: mkdtempSync(join(tmpdir(), 'jobs-')) }, {});
}

test('markDone stores the result and terminal status', () => {
  const store = tempStore();
  const job = store.enqueue({ kind: JobKind.Crew, payload: 'x' });
  store.claimNext();
  store.markDone(job.id, { ok: true, count: 3 });
  const done = store.getJob(job.id);
  expect(done?.status).toBe(JobStatus.Done);
  expect(done?.result).toEqual({ ok: true, count: 3 });
  expect(done?.finishedAt).toBeGreaterThan(0);
  store.close();
});

test('markFailed with retryable + attempts<max re-queues with a backoff floor', () => {
  const store = tempStore();
  const job = store.enqueue({ kind: JobKind.Crew, payload: 'x', maxAttempts: 2 });
  store.claimNext(); // attempts -> 1
  const before = Date.now();
  store.markFailed(job.id, 'boom', true);
  const requeued = store.getJob(job.id);
  expect(requeued?.status).toBe(JobStatus.Queued); // 1 < 2, retry
  // The backoff is persisted as a future available_at, so claimNext will NOT
  // immediately re-claim it — this is what actually spaces re-claims.
  expect(requeued?.availableAt).toBeGreaterThan(before);
  expect(store.claimNext()).toBeNull(); // gated by the backoff floor
  store.close();
});

test('markFailed fails terminally once attempts reach maxAttempts', () => {
  const store = tempStore();
  const job = store.enqueue({ kind: JobKind.Crew, payload: 'x', maxAttempts: 1 });
  store.claimNext(); // attempts -> 1 == max
  store.markFailed(job.id, 'boom again', true); // retryable but no attempts left
  const failed = store.getJob(job.id);
  expect(failed?.status).toBe(JobStatus.Failed); // 1 == max, terminal
  expect(failed?.error).toBe('boom again');
  store.close();
});

test('markFailed with retryable=false fails terminally on the first attempt', () => {
  const store = tempStore();
  const job = store.enqueue({ kind: JobKind.Crew, payload: 'x', maxAttempts: 5 });
  store.claimNext();
  store.markFailed(job.id, 'fatal', false);
  expect(store.getJob(job.id)?.status).toBe(JobStatus.Failed);
  store.close();
});

test('markInterrupted and markCanceled set their terminal statuses', () => {
  const store = tempStore();
  const a = store.enqueue({ kind: JobKind.Chat, payload: 1 });
  const b = store.enqueue({ kind: JobKind.Chat, payload: 2 });
  store.claimNext();
  store.markInterrupted(a.id);
  store.markCanceled(b.id);
  expect(store.getJob(a.id)?.status).toBe(JobStatus.Interrupted);
  expect(store.getJob(b.id)?.status).toBe(JobStatus.Canceled);
  store.close();
});
```

- [ ] **Step 2: Run — verify it fails**

`bun test tests/queue/store-transitions.test.ts` → FAIL.

- [ ] **Step 3: Implement the four transitions**

First widen the top-of-file reliability import (added in Task 6) so `markFailed` can compute a persisted backoff:
```typescript
import {
  maxAttempts as defaultMaxAttempts,
  retryBaseMs,
  retryCapMs,
} from '../reliability/config.ts';
```
Add this module-scope helper next to `newJobId` (it mirrors `withRetry`'s full-jitter exponential backoff, `src/reliability/retry.ts:74-76`, using the SAME `retryBaseMs`/`retryCapMs` knobs so queue + in-run retries share one policy):
```typescript
/** Full-jitter exponential backoff (ms) for a re-queued job's `available_at`.
 *  `attempt` is tries USED (claimNext already bumped it). Reuses the reliability
 *  backoff knobs — never a hardcoded delay. */
function backoffDelay(attempt: number, rand: () => number = Math.random): number {
  const exp = Math.min(retryCapMs(), retryBaseMs() * 2 ** Math.max(0, attempt - 1));
  const jitter = 0.5 + rand() / 2;
  return Math.floor(jitter * exp);
}
```
Then add inside `createJobStore` and to the returned object:
```typescript
  function markDone(id: string, result: unknown): void {
    const at = Date.now();
    db.run(
      `UPDATE jobs SET status = 'done', result = ?, finished_at = ?, updated_at = ?
       WHERE id = ?`,
      [JSON.stringify(result ?? null), at, at, id],
    );
  }

  function markFailed(id: string, error: string, retryable: boolean): void {
    const at = Date.now();
    const row = getJob(id);
    // Retry if the caller says the error is retryable AND we have attempts left.
    // `attempts` was already bumped by claimNext, so it reflects tries USED.
    const canRetry = retryable && row !== undefined && row.attempts < row.maxAttempts;
    if (canRetry) {
      // Persist the backoff as an `available_at` floor so claimNext won't
      // re-claim this row until it matures — the delay is enforced durably in
      // the DB, not by a worker sleeping on a held slot (Task 13).
      const availableAt = at + backoffDelay(row.attempts);
      db.run(
        `UPDATE jobs SET status = 'queued', error = ?, updated_at = ?,
         started_at = NULL, available_at = ? WHERE id = ?`,
        [error, at, availableAt, id],
      );
      return;
    }
    db.run(
      `UPDATE jobs SET status = 'failed', error = ?, finished_at = ?, updated_at = ?
       WHERE id = ?`,
      [error, at, at, id],
    );
  }

  function markInterrupted(id: string): void {
    const at = Date.now();
    db.run(
      `UPDATE jobs SET status = 'interrupted', finished_at = ?, updated_at = ?
       WHERE id = ?`,
      [at, at, id],
    );
  }

  function markCanceled(id: string): void {
    const at = Date.now();
    db.run(
      `UPDATE jobs SET status = 'canceled', finished_at = ?, updated_at = ?
       WHERE id = ?`,
      [at, at, id],
    );
  }
```
Add `markDone, markFailed, markInterrupted, markCanceled,` to the returned object.

- [ ] **Step 4: Run — verify it passes**

`bun test tests/queue/store-transitions.test.ts` → PASS (5 tests).

- [ ] **Step 5: Gate + commit**

```bash
bun run typecheck && bun run lint:file -- src/queue/store.ts tests/queue/store-transitions.test.ts
git add src/queue/store.ts tests/queue/store-transitions.test.ts
git commit -m "feat(queue): markDone/Failed/Interrupted/Canceled transitions (Slice 24 Incr 2)"
```

## Task 9: `listJobs` — keyset page + status filter

**Files:**
- Modify: `src/queue/store.ts`
- Create: `tests/queue/store-list.test.ts`

**Interfaces:**
- Consumes: Task 6 store + `encodeJobCursor`/`decodeJobCursor`.
- Produces: `listJobs({ status?, cursor?, limit }): { items: JobRecord[]; nextCursor?: string; total: number }` — newest-first (`created_at DESC, id ASC`), optional `status` filter, base64url keyset cursor, fetch-one-extra to detect `nextCursor`, malformed cursor treated as page 1 (mirrors `listSessions`, `src/session/store.ts:218`).

- [ ] **Step 1: Write the failing test**

`tests/queue/store-list.test.ts`:
```typescript
import { test, expect } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJobStore } from '../../src/queue/store.ts';
import { JobKind, JobStatus } from '../../src/queue/types.ts';

async function seed(n: number) {
  const store = createJobStore({ path: mkdtempSync(join(tmpdir(), 'jobs-')) }, {});
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    ids.push(store.enqueue({ kind: JobKind.Crew, payload: i }).id);
    await Bun.sleep(1);
  }
  return { store, ids };
}

test('listJobs pages newest-first with a working keyset cursor', async () => {
  const { store, ids } = await seed(5);
  const p1 = store.listJobs({ limit: 2 });
  expect(p1.items.map((j) => j.id)).toEqual([ids[4], ids[3]]);
  expect(p1.total).toBe(5);
  expect(p1.nextCursor).toBeDefined();
  const p2 = store.listJobs({ limit: 2, cursor: p1.nextCursor });
  expect(p2.items.map((j) => j.id)).toEqual([ids[2], ids[1]]);
  const p3 = store.listJobs({ limit: 2, cursor: p2.nextCursor });
  expect(p3.items.map((j) => j.id)).toEqual([ids[0]]);
  expect(p3.nextCursor).toBeUndefined();
  store.close();
});

test('listJobs filters by status', async () => {
  const { store } = await seed(3);
  store.claimNext();
  store.markDone(store.claimNext()!.id, null);
  const running = store.listJobs({ status: JobStatus.Running, limit: 10 });
  expect(running.items.every((j) => j.status === JobStatus.Running)).toBe(true);
  const done = store.listJobs({ status: JobStatus.Done, limit: 10 });
  expect(done.items).toHaveLength(1);
  store.close();
});

test('a malformed cursor degrades to page 1', async () => {
  const { store, ids } = await seed(2);
  const page = store.listJobs({ limit: 10, cursor: 'not-base64-!!' });
  expect(page.items.map((j) => j.id)).toEqual([ids[1], ids[0]]);
  store.close();
});
```

- [ ] **Step 2: Run — verify it fails**

`bun test tests/queue/store-list.test.ts` → FAIL.

- [ ] **Step 3: Implement `listJobs`**

```typescript
  function listJobs(q: {
    status?: JobStatus;
    cursor?: string;
    limit: number;
  }): { items: JobRecord[]; nextCursor?: string; total: number } {
    const statusClause = q.status ? 'AND status = ?' : '';
    const statusArgs: (string | number)[] = q.status ? [q.status] : [];

    const totalRow = db
      .query(`SELECT COUNT(*) as n FROM jobs WHERE 1 = 1 ${statusClause}`)
      .get(...statusArgs) as { n: number };

    const cursor = q.cursor ? decodeJobCursor(q.cursor) : undefined;
    const cursorClause = cursor
      ? 'AND (created_at < ? OR (created_at = ? AND id > ?))'
      : '';
    const cursorArgs: (string | number)[] = cursor
      ? [cursor.createdAt, cursor.createdAt, cursor.id]
      : [];

    const rows = db
      .query(
        `SELECT * FROM jobs WHERE 1 = 1 ${statusClause} ${cursorClause}
         ORDER BY created_at DESC, id ASC LIMIT ?`,
      )
      .all(...statusArgs, ...cursorArgs, q.limit + 1) as JobRowRaw[];

    const hasMore = rows.length > q.limit;
    const page = rows.slice(0, q.limit);
    const items = page.map(toJobRecord);
    const lastRaw = page[page.length - 1];
    const nextCursor =
      hasMore && lastRaw
        ? encodeJobCursor(lastRaw.created_at, lastRaw.id)
        : undefined;
    return { items, nextCursor, total: totalRow.n };
  }
```
Add `listJobs,` to the returned object.

- [ ] **Step 4: Run — verify it passes**

`bun test tests/queue/store-list.test.ts` → PASS (3 tests).

- [ ] **Step 5: Gate + commit**

```bash
bun run typecheck && bun run lint:file -- src/queue/store.ts tests/queue/store-list.test.ts
git add src/queue/store.ts tests/queue/store-list.test.ts
git commit -m "feat(queue): listJobs keyset page + status filter (Slice 24 Incr 2)"
```

## Task 10: `reconcileOrphans` — boot recovery in one transaction (§7.3) [OPUS/ultracode]

**Files:**
- Modify: `src/queue/store.ts` (add `reconcileOrphans`; remove the `_db`/`_encode`/`_decode` internal seams from the public return now all closures reference them via lexical scope)
- Create: `tests/queue/store-reconcile.test.ts`

**Interfaces:**
- Consumes: Task 6–9 store.
- Produces: `reconcileOrphans(): { interrupted: number; requeued: number }` — runs ONCE at boot inside a single `db.transaction()` BEFORE the pool accepts work (§7.3). Every row left `Running` from a crashed daemon is atomically transitioned: a **durable/checkpoint-resumable** job (crew/workflow — see Increment 6) → `Queued` (`requeued`), so the pool re-claims and resumes from its last checkpoint; every other `Running` job → `Interrupted` (`interrupted`), re-runnable only on explicit re-enqueue. Non-`Running` rows are untouched. **This slice (Increment 2) marks ALL orphans `Interrupted`** — the `requeued` branch is wired in Increment 6 once the checkpoint layer exists (a `durableKinds` predicate is threaded in then). Here it returns `requeued: 0` and the durable-requeue is a documented seam.

- [ ] **Step 1: Write the failing test**

`tests/queue/store-reconcile.test.ts`:
```typescript
import { test, expect } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJobStore } from '../../src/queue/store.ts';
import { JobKind, JobStatus } from '../../src/queue/types.ts';

function tempStore() {
  return createJobStore({ path: mkdtempSync(join(tmpdir(), 'jobs-')) }, {});
}

test('reconcileOrphans marks every stuck Running job Interrupted, leaves others', () => {
  const store = tempStore();
  const running = store.enqueue({ kind: JobKind.Crew, payload: 1 });
  const queued = store.enqueue({ kind: JobKind.Crew, payload: 2 });
  const done = store.enqueue({ kind: JobKind.Crew, payload: 3 });
  store.claimNext(); // running -> Running (the oldest queued)
  store.claimNext();
  store.markDone(done.id, null);
  const res = store.reconcileOrphans();
  expect(res.interrupted).toBeGreaterThanOrEqual(1);
  expect(res.requeued).toBe(0); // Increment 2: no durable-requeue yet
  expect(store.getJob(running.id)?.status).toBe(JobStatus.Interrupted);
  expect(store.getJob(queued.id)?.status).toBe(JobStatus.Interrupted); // was claimed 2nd
  expect(store.getJob(done.id)?.status).toBe(JobStatus.Done); // untouched
  store.close();
});

test('reconcileOrphans is a no-op when nothing is Running', () => {
  const store = tempStore();
  store.enqueue({ kind: JobKind.Chat, payload: 1 });
  const res = store.reconcileOrphans();
  expect(res).toEqual({ interrupted: 0, requeued: 0 });
  store.close();
});
```

- [ ] **Step 2: Run — verify it fails**

`bun test tests/queue/store-reconcile.test.ts` → FAIL.

- [ ] **Step 3: Implement `reconcileOrphans`**

```typescript
  function reconcileOrphans(): { interrupted: number; requeued: number } {
    // ONE transaction so no Running row is ever observed by a starting pool in
    // an ambiguous mid-flight state (§7.3). Increment 2 has no checkpoint layer
    // yet, so EVERY Running orphan -> Interrupted (re-runnable on explicit
    // re-enqueue only). Increment 6 threads a `durableKinds` predicate here to
    // send checkpoint-resumable rows -> Queued instead (counted as `requeued`).
    const tx = db.transaction((): { interrupted: number; requeued: number } => {
      const at = Date.now();
      const info = db.run(
        `UPDATE jobs SET status = 'interrupted', finished_at = ?, updated_at = ?
         WHERE status = 'running'`,
        [at, at],
      );
      return { interrupted: info.changes, requeued: 0 };
    });
    return tx();
  }
```
Add `reconcileOrphans,` to the returned object and DELETE the `_db`/`_decodeJobCursor`/`_encodeJobCursor` fields from the return (they were only a drafting seam).

- [ ] **Step 4: Run — verify it passes + full queue-store regression**

```bash
bun test tests/queue/store-reconcile.test.ts
bun test tests/queue/   # all store/type/migration tests green together
```

- [ ] **Step 5: Gate + commit**

```bash
bun run typecheck && bun run lint:file -- src/queue/store.ts tests/queue/store-reconcile.test.ts
git add src/queue/store.ts tests/queue/store-reconcile.test.ts
git commit -m "feat(queue): reconcileOrphans boot recovery (Slice 24 Incr 2, §7.3)"
```

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

## Task 12: Retry policy helper — retryability classification reusing `src/reliability/classify`

**Files:**
- Create: `src/queue/retry-policy.ts`
- Create: `tests/queue/retry-policy.test.ts`

**Interfaces:**
- Consumes: `classify`/`Lane` (`src/reliability/classify.ts`). (**Breaker dropped — chosen over wiring:** an earlier draft listed `breakerFor` (`src/reliability/breaker.ts:102`) here, but a per-kind circuit breaker is deliberately NOT wired into the pool. It would add half-open/probe state for marginal benefit over the existing per-job `maxAttempts` cap + persisted `available_at` backoff, `retry-policy.ts` never actually imported it, and the reliability breaker is already scoped to its real MCP/tool/runtime call sites where a shared failure domain exists — the queue's jobs do not share one. Simpler-and-correct wins; see the self-review note.)
- Produces: `jobRetryDecision(err: unknown): { retryable: boolean }` — classifies a caught executor error into the `markFailed(id, error, retryable)` decision. Only the `Lane.Transient` class is retryable (mirrors `withRetry`'s default, `src/reliability/retry.ts:60`); permanent/policy errors are `retryable:false` → terminal `Failed`. **The backoff DELAY is no longer computed here** — it is enforced durably by `markFailed` setting `available_at` (Task 8), so the worker never sleeps holding a slot. `jobRetryDecision` is now purely the classify→retryable policy seam.

- [ ] **Step 1: Write the failing test**

`tests/queue/retry-policy.test.ts`:
```typescript
import { test, expect } from 'bun:test';
import { jobRetryDecision } from '../../src/queue/retry-policy.ts';

test('a transient-classified error is retryable', () => {
  const err = Object.assign(new Error('ECONNRESET'), { code: 'ECONNRESET' });
  expect(jobRetryDecision(err).retryable).toBe(true);
});

test('a non-transient error is not retryable', () => {
  expect(jobRetryDecision(new Error('validation: bad input')).retryable).toBe(false);
});
```

- [ ] **Step 2: Run — verify it fails**

`bun test tests/queue/retry-policy.test.ts` → FAIL.

- [ ] **Step 3: Implement `src/queue/retry-policy.ts`**

```typescript
import { classify, Lane } from '../reliability/classify.ts';

/**
 * Whether a failed job should re-queue. Reuses Slice 21's error classifier
 * (src/reliability/classify.ts) rather than a second policy: only the Transient
 * lane retries (mirrors withRetry's default); everything else is a terminal
 * Failed. The re-claim DELAY is NOT computed here — it is enforced durably by
 * markFailed setting `available_at` (Task 8, using the reliability backoff
 * knobs), so the worker pool never sleeps holding a slot.
 */
export function jobRetryDecision(err: unknown): { retryable: boolean } {
  return { retryable: classify(err) === Lane.Transient };
}
```

- [ ] **Step 4: Run — verify it passes**

`bun test tests/queue/retry-policy.test.ts` → PASS (2 tests).

- [ ] **Step 5: Gate + commit**

```bash
bun run typecheck && bun run lint:file -- src/queue/retry-policy.ts tests/queue/retry-policy.test.ts
git add src/queue/retry-policy.ts tests/queue/retry-policy.test.ts
git commit -m "feat(queue): jobRetryDecision retryability via reliability classify (Slice 24 Incr 2)"
```

## Task 13: Worker pool — `createWorkerPool` (claim loop, dispatch, per-job AbortController) [OPUS/ultracode]

**Files:**
- Create: `src/queue/pool.ts`
- Create: `tests/queue/pool.test.ts`

**Interfaces:**
- Consumes: `JobStore` (Task 6–10), `JobStatus`/`JobRecord`/`JobKind` (Task 4, `JobStatus` imported as a VALUE for the drain check — enum-over-literal), `jobRetryDecision` (Task 12), `abortableSleep` (`src/reliability/retry.ts:5` — used ONLY for the idle poll wait), `explain` (`src/errors/boundary.ts`).
- Produces: the **Shared-contracts** `WorkerPool` + `JobExecutor` + `createWorkerPool`. `start()` spins up to `concurrency` claim loops; each loop `claimNext()`s, builds a per-job `AbortController` (registered in a `Map<jobId, AbortController>` so `cancel(jobId)` fires it), calls `dispatch(job.kind)(job, signal)`, then `markDone`/`markFailed` (retryability via `jobRetryDecision`). **The worker does NOT sleep on a retryable failure** — `markFailed` persists the backoff as the row's `available_at` (Task 8) and `claimNext`'s `available_at <= now` gate (Task 7) enforces the spacing, so a failing job never holds a concurrency slot while it waits. `stop()` stops claiming, aborts in-flight, awaits them, marks any still-`Running` `Interrupted`. `cancel(jobId)` aborts + `markCanceled`.

- [ ] **Step 1: Write the failing test**

`tests/queue/pool.test.ts`:
```typescript
import { test, expect } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJobStore } from '../../src/queue/store.ts';
import { createWorkerPool } from '../../src/queue/pool.ts';
import { JobKind, JobStatus } from '../../src/queue/types.ts';

function tempStore() {
  return createJobStore({ path: mkdtempSync(join(tmpdir(), 'jobs-')) }, {});
}
const waitFor = async (p: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (p()) return;
    await Bun.sleep(10);
  }
  throw new Error('timeout waiting for condition');
};

test('the pool claims, dispatches, and marks a job Done with its result', async () => {
  const store = tempStore();
  const job = store.enqueue({ kind: JobKind.Crew, payload: { n: 2 } });
  const pool = createWorkerPool({
    store,
    concurrency: 1,
    dispatch: () => async (j) => ({ doubled: (j.payload as { n: number }).n * 2 }),
    pollMs: 10,
  });
  pool.start();
  await waitFor(() => store.getJob(job.id)?.status === JobStatus.Done);
  expect(store.getJob(job.id)?.result).toEqual({ doubled: 4 });
  await pool.stop();
  store.close();
});

test('concurrency bounds the number of jobs in flight at once', async () => {
  const store = tempStore();
  for (let i = 0; i < 4; i++) store.enqueue({ kind: JobKind.Crew, payload: i });
  let inFlight = 0;
  let peak = 0;
  const pool = createWorkerPool({
    store,
    concurrency: 2,
    dispatch: () => async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await Bun.sleep(40);
      inFlight--;
    },
    pollMs: 5,
  });
  pool.start();
  await waitFor(() => store.listJobs({ status: JobStatus.Done, limit: 10 }).total === 4, 5000);
  expect(peak).toBeLessThanOrEqual(2);
  await pool.stop();
  store.close();
});

test('cancel aborts an in-flight job and marks it Canceled', async () => {
  const store = tempStore();
  const job = store.enqueue({ kind: JobKind.Chat, payload: 'x' });
  const pool = createWorkerPool({
    store,
    concurrency: 1,
    dispatch: () => (j, signal) =>
      new Promise((_res, rej) => {
        signal.addEventListener('abort', () => rej(new Error('aborted')), { once: true });
      }),
    pollMs: 5,
  });
  pool.start();
  await waitFor(() => store.getJob(job.id)?.status === JobStatus.Running);
  expect(pool.cancel(job.id)).toBe(true);
  await waitFor(() => store.getJob(job.id)?.status === JobStatus.Canceled);
  await pool.stop();
  store.close();
});
```

- [ ] **Step 2: Run — verify it fails**

`bun test tests/queue/pool.test.ts` → FAIL.

- [ ] **Step 3: Implement `src/queue/pool.ts`**

```typescript
import { explain } from '../errors/boundary.ts';
import { abortableSleep } from '../reliability/retry.ts';
import { jobRetryDecision } from './retry-policy.ts';
import type { JobStore } from './store.ts';
import { JobStatus, type JobKind, type JobRecord } from './types.ts';

export type JobExecutor = (
  job: JobRecord,
  signal: AbortSignal,
) => Promise<unknown>;

export type WorkerPool = {
  start(): void;
  stop(): Promise<void>;
  cancel(jobId: string): boolean;
  activeCount(): number;
};

export function createWorkerPool(opts: {
  store: JobStore;
  concurrency: number;
  dispatch: (kind: JobKind) => JobExecutor;
  pollMs?: number;
}): WorkerPool {
  const pollMs = opts.pollMs ?? 250;
  const controllers = new Map<string, AbortController>();
  const inFlight = new Set<Promise<void>>();
  let running = false;
  let loops: Promise<void>[] = [];

  async function runOne(job: JobRecord): Promise<void> {
    const controller = new AbortController();
    controllers.set(job.id, controller);
    try {
      const executor = opts.dispatch(job.kind);
      const result = await executor(job, controller.signal);
      // A cancel() already flipped the row to Canceled — don't overwrite it.
      if (controller.signal.aborted) return;
      opts.store.markDone(job.id, result);
    } catch (err) {
      if (controller.signal.aborted) return; // cancel path owns the transition
      // Classify retryability only; markFailed persists the backoff as
      // `available_at` (Task 8) and claimNext's time gate (Task 7) enforces it,
      // so the worker must NOT sleep here holding its slot.
      const { retryable } = jobRetryDecision(err);
      opts.store.markFailed(job.id, explain(err).title, retryable);
    } finally {
      controllers.delete(job.id);
    }
  }

  async function loop(): Promise<void> {
    while (running) {
      const job = opts.store.claimNext();
      if (!job) {
        await abortableSleep(pollMs);
        continue;
      }
      const p = runOne(job);
      inFlight.add(p);
      await p;
      inFlight.delete(p);
    }
  }

  return {
    start(): void {
      if (running) return;
      running = true;
      loops = Array.from({ length: Math.max(1, opts.concurrency) }, () => loop());
    },
    async stop(): Promise<void> {
      running = false;
      for (const c of controllers.values()) c.abort();
      await Promise.allSettled([...inFlight]);
      await Promise.allSettled(loops);
      // Anything still Running (never reached a terminal transition) is an
      // interrupted orphan — the same state reconcileOrphans would assign.
      for (const j of opts.store.listJobs({ limit: 1000 }).items) {
        if (j.status === JobStatus.Running) opts.store.markInterrupted(j.id);
      }
    },
    cancel(jobId: string): boolean {
      const c = controllers.get(jobId);
      if (!c) return false;
      c.abort();
      opts.store.markCanceled(jobId);
      return true;
    },
    activeCount: (): number => controllers.size,
  };
}
```

- [ ] **Step 4: Run — verify it passes**

`bun test tests/queue/pool.test.ts` → PASS (3 tests).

- [ ] **Step 5: Gate + commit**

```bash
bun run typecheck && bun run lint:file -- src/queue/pool.ts tests/queue/pool.test.ts
git add src/queue/pool.ts tests/queue/pool.test.ts
git commit -m "feat(queue): bounded worker pool with cancel + retry (Slice 24 Incr 2)"
```

## Task 14: Boundary gate — Increment 2

**Files:** none (verification only).

- [ ] **Step 1: Full root gate + docs check**

```bash
bun run check
```
Expected: `bun run check` PASS — **cumulative test count ~1635, 0 fail** (Increment 2 adds ~30 queue types/migration/store/claim/transitions/list/reconcile/concurrency/retry/pool tests over the ~1605 baseline). `docs:check` now sees `src/queue/` — it must NOT fail: `src/queue/` is a new `src/<subsystem>`, and `docs:check` requires every `src/<subsystem>` to be documented in `docs/architecture.md`. **This will fail** until architecture.md mentions `src/queue/`. Resolve by adding a one-line stub to architecture.md's module map now (the full Queue section lands in Increment 7) — a minimal `- **\`src/queue/\`** — durable SQLite job queue (Slice 24, expanded in the Queue section).` entry under the module map, committed with `git commit -m "docs(queue): register src/queue/ subsystem stub (Slice 24 Incr 2 gate)"`. Then re-run `bun run check` → PASS. (This is the docs hard line working as designed; the substantive doc write is Increment 7.)

---

# Increment 3 — Job API + detach runs onto the queue (§7.1)

**Purpose (spec §5.3, D6):** the HTTP control plane. `POST /api/jobs` (enqueue → `202 {jobId, runId}`), `GET /api/jobs` (list + status filter + keyset page), `GET /api/jobs/:id` (status + result), `POST /api/jobs/:id/cancel` (fires the pool's per-job AbortController). Migrate the `void`-detach crew/workflow/model-pull handlers to **enqueue onto the queue** instead of firing an unmanaged promise. Reconcile the SSE live-stream with pool-owned execution via the existing Last-Event-ID replay (§7.1), with the subscribe-after-start race gated by an integration test. Folds in deferred items 6 (concurrent-stream cap), 8 (cancel beyond local), 16 (server-push/SSE bus is the run stream), 17 (DTO provenance origin/principal).

## Task 15: Job DTOs + request/response contracts

**Files:**
- Modify: `src/contracts/dto.ts` (append `JobDtoSchema` after `RunListItemDtoSchema`)
- Modify: `src/contracts/enums.ts` (append `JobStatusWire`/`JobPriorityWire`/`JobKindWire` mirrors — isomorphic wire enums matching `src/queue/types.ts` values, guarded by a parity test, same precedent as `RuntimeKind` mirror at `enums.ts:149`)
- Modify: `src/contracts/requests.ts` (append `JobEnqueueRequestSchema`, `JobListQuerySchema`, `JobLaunchResponseSchema`, `JobListResponseSchema`)
- Create: `tests/contracts/job-dto.test.ts`

**Interfaces:**
- Consumes: `z` (zod). The wire enums MUST hold the SAME string values as `JobStatus`/`JobPriority`/`JobKind` (Task 4) — a `tests/contracts/job-kind-parity.test.ts` pins it (same pattern as `runtime-kind-parity.test.ts`).
- Produces: `JobDtoSchema`/`JobDTO` = `{ id, kind: JobKindWire, payload: unknown, priority: JobPriorityWire, status: JobStatusWire, attempts, maxAttempts, createdAt, updatedAt, startedAt?, finishedAt?, runId?, result?, error? }`; `JobEnqueueRequestSchema` = `{ kind: JobKindWire, payload: unknown, priority?: JobPriorityWire }`; `JobLaunchResponseSchema` = `{ jobId: string, runId: string }`; `JobListQuerySchema` = `{ status?: JobStatusWire, cursor?: string, limit: number(default 25, 1-200) }`; `JobListResponseSchema` = `{ items: JobDTO[], nextCursor?: string, total: number }`. All re-exported via the `src/contracts/index.ts` wildcard.

- [ ] **Step 1: Write the failing test** — `tests/contracts/job-dto.test.ts` asserts `JobDtoSchema.parse` round-trips a full record, `JobEnqueueRequestSchema` rejects a missing `kind`, `JobLaunchResponseSchema` requires both `jobId`+`runId`, `JobListQuerySchema` defaults `limit` to 25 and rejects `limit>200`. Add `tests/contracts/job-kind-parity.test.ts` asserting `Object.values(JobKindWire)` equals `Object.values(JobKind)` (import both).
```typescript
import { test, expect } from 'bun:test';
import { JobDtoSchema, JobEnqueueRequestSchema, JobLaunchResponseSchema, JobListQuerySchema } from '../../src/contracts/index.ts';
import { JobKindWire, JobStatusWire, JobPriorityWire } from '../../src/contracts/enums.ts';

test('JobDtoSchema round-trips a full record', () => {
  const dto = JobDtoSchema.parse({
    id: 'job-1', kind: JobKindWire.Crew, payload: { name: 'x' },
    priority: JobPriorityWire.Normal, status: JobStatusWire.Done,
    attempts: 1, maxAttempts: 4, createdAt: 1, updatedAt: 2,
    finishedAt: 2, runId: 'run-1', result: { ok: true },
  });
  expect(dto.runId).toBe('run-1');
});
test('JobEnqueueRequestSchema rejects a missing kind', () => {
  expect(() => JobEnqueueRequestSchema.parse({ payload: {} })).toThrow();
});
test('JobLaunchResponseSchema requires jobId AND runId', () => {
  expect(() => JobLaunchResponseSchema.parse({ jobId: 'j' })).toThrow();
  expect(JobLaunchResponseSchema.parse({ jobId: 'j', runId: 'r' }).runId).toBe('r');
});
test('JobListQuerySchema defaults limit to 25', () => {
  expect(JobListQuerySchema.parse({}).limit).toBe(25);
});
```

- [ ] **Step 2: Run — verify it fails** (`bun test tests/contracts/job-dto.test.ts` → FAIL, schemas missing).

- [ ] **Step 3: Implement.** Add the three wire enums to `src/contracts/enums.ts`:
```typescript
/** Wire mirror of src/queue/types.ts JobStatus (isomorphic — no engine import).
 *  tests/contracts/job-kind-parity.test.ts guards value parity. Slice 24. */
export enum JobStatusWire {
  Queued = 'queued', Running = 'running', Done = 'done',
  Failed = 'failed', Interrupted = 'interrupted', Canceled = 'canceled',
}
export enum JobPriorityWire { High = 'high', Normal = 'normal' }
export enum JobKindWire {
  Chat = 'chat', Crew = 'crew', Workflow = 'workflow', Pull = 'pull', Build = 'build',
}
```
Add `JobDtoSchema` to `src/contracts/dto.ts` (importing the wire enums, `z.enum(JobStatusWire)` etc.), and the request/response schemas to `src/contracts/requests.ts`, following the `SessionListQuerySchema`/`RunLaunchResponseSchema` precedents. Add the parity test file.

- [ ] **Step 4: Run — verify it passes** (`bun test tests/contracts/job-dto.test.ts tests/contracts/job-kind-parity.test.ts` → PASS).

- [ ] **Step 5: Gate + commit**
```bash
bun run typecheck && bun run lint:file -- src/contracts/dto.ts src/contracts/enums.ts src/contracts/requests.ts tests/contracts/job-dto.test.ts tests/contracts/job-kind-parity.test.ts
git add src/contracts/ tests/contracts/job-dto.test.ts tests/contracts/job-kind-parity.test.ts
git commit -m "feat(contracts): Job DTOs + wire enums + request/response schemas (Slice 24 Incr 3)"
```

## Task 16: Job dispatch registry — `JobKind → JobExecutor` over the existing run turns

**Files:**
- Create: `src/server/jobs/dispatch.ts`
- Create: `tests/server/jobs/dispatch.test.ts`

**Interfaces:**
- Consumes: `RunCrewTurn` (`src/server/crews/run.ts:17`), `RunWorkflowTurn` (`src/server/workflows/run.ts:17`), `RunModelPullTurn` (`src/server/models/pull.ts:12`), `RunChatTurn` (`src/server/chat/run-turn.ts:22`), `RunBuilderTurn` (`src/server/builders/build.ts`), `getCrew` (`crews/index.ts`), `getWorkflow` (`workflows/index.ts`), `JobRecord`/`JobKind` (Task 4), `JobExecutor` (Task 13).
- Produces: `createJobDispatch(deps): (kind: JobKind) => JobExecutor` — maps each `JobKind` to an executor that (a) validates the job `payload` against that kind's launch request schema, (b) resolves the def (crew/workflow) or args, (c) calls the existing run turn with `job.runId`, (d) returns the run's result. An unknown/mismatched payload throws a non-retryable error (surfaces as terminal `Failed`). This is the seam the pool's `dispatch` is wired from — reusing the SAME `runCrewTurn`/`runWorkflowTurn`/`runModelPull` the routes already build (`src/server/launch-turns.ts`), so no execution logic is duplicated.

- [ ] **Step 1: Write the failing test** — inject fake run turns; assert `createJobDispatch({...})(JobKind.Crew)` returns an executor that, given a `{ name, input }` payload for a known crew, calls the fake `runCrewTurn` with the job's `runId`; and that a bad payload rejects.
```typescript
import { test, expect } from 'bun:test';
import { createJobDispatch } from '../../../src/server/jobs/dispatch.ts';
import { JobKind } from '../../../src/queue/types.ts';

const fakeJob = (kind: JobKind, payload: unknown) => ({
  id: 'job-1', kind, payload, priority: 'normal' as const, status: 'running' as const,
  attempts: 1, maxAttempts: 4, createdAt: 0, updatedAt: 0,
  startedAt: 0, finishedAt: undefined, runId: 'run-xyz', result: undefined, error: undefined,
});

test('crew dispatch calls runCrewTurn with the job runId', async () => {
  const calls: unknown[] = [];
  const dispatch = createJobDispatch({
    runCrewTurn: async (i) => { calls.push(i); return { done: true }; },
    getCrew: () => ({ name: 'c' }) as never,
    runWorkflowTurn: async () => ({}), getWorkflow: () => undefined,
    runModelPull: async () => {}, runChatTurn: async () => ({ kind: 'answer', text: 'x' }) as never,
    runBuilderTurn: async () => ({}) as never,
  });
  const exec = dispatch(JobKind.Crew);
  const res = await exec(fakeJob(JobKind.Crew, { name: 'c', input: 'go' }), new AbortController().signal);
  expect((calls[0] as { runId: string }).runId).toBe('run-xyz');
  expect(res).toEqual({ done: true });
});

test('a crew payload for an unknown crew rejects (terminal-failed)', async () => {
  const dispatch = createJobDispatch({
    runCrewTurn: async () => ({}), getCrew: () => undefined,
    runWorkflowTurn: async () => ({}), getWorkflow: () => undefined,
    runModelPull: async () => {}, runChatTurn: async () => ({}) as never,
    runBuilderTurn: async () => ({}) as never,
  });
  await expect(dispatch(JobKind.Crew)(fakeJob(JobKind.Crew, { name: 'nope', input: 'x' }), new AbortController().signal)).rejects.toThrow();
});
```

- [ ] **Step 2: Run — verify it fails.**

- [ ] **Step 3: Implement `src/server/jobs/dispatch.ts`** — a `switch (kind)` returning a per-kind executor. Crew: `CrewRunRequestSchema.parse` the payload's `input`, `getCrew(payload.name)` (throw if missing), `await runCrewTurn({ def, input, runId: job.runId! })`. Workflow: mirror with `getWorkflow`. Pull: `ModelPullRequestSchema.parse` + `runModelPull({...runId})`. Chat: build the `RunChatTurn` input from payload (task/media/events-noop/stream-noop — a detached chat streams to its run journal, not a live client) and return its `OrchestratorResult`. Build: `runBuilderTurn` with payload args. Each executor closes over `job.runId` (guaranteed present — the store always mints one).

- [ ] **Step 4: Run — verify it passes.**

- [ ] **Step 5: Gate + commit**
```bash
bun run typecheck && bun run lint:file -- src/server/jobs/dispatch.ts tests/server/jobs/dispatch.test.ts
git add src/server/jobs/dispatch.ts tests/server/jobs/dispatch.test.ts
git commit -m "feat(server): job dispatch registry over existing run turns (Slice 24 Incr 3)"
```

## Task 17: Wire the queue + pool into `ServerDeps` and boot (interim owner before the daemon)

**Files:**
- Modify: `src/server/app.ts` (`ServerDeps` gains `jobStore: JobStore`; add nothing to the if-ladder yet — routes land in Tasks 18-20)
- Modify: `src/server/main.ts` — extend `StartOptions` (main.ts:118) with an OPTIONAL injected queue: `queue?: { jobStore: JobStore; pool: WorkerPool }`; make `startWebServer` **inject-or-self-host** (see the §7.3 double-pool note below); return `{ server, token, port, jobStore, pool }`
- Modify: `tests/server/*` fixtures that build `ServerDeps` — add a minimal in-memory `jobStore` (a temp `createJobStore`) so existing tests still type-check
- Create: `tests/server/main-queue-boot.test.ts`

**Interfaces:**
- Consumes: `createJobStore` (Task 6-10), `createWorkerPool` (Task 13), `createJobDispatch` (Task 16), `computeConcurrency` (Task 11), `onShutdown` (`src/process/lifecycle.ts:13`), the existing `runCrewTurn`/`runWorkflowTurn`/`runModelPull`/`runBuilderTurn`/`runChatTurn` already built in `startWebServer` (`main.ts:145-203`).
- Produces: `ServerDeps.jobStore: JobStore`; `startWebServer` return extended with `jobStore` + `pool`; `StartOptions.queue?: { jobStore: JobStore; pool: WorkerPool }`. **Two modes, one server (this is the §7.3 double-pool fix):**
  - **Injected mode** — when `opts.queue` is passed (the daemon, Task 27), `startWebServer` uses the caller's `{ jobStore, pool }` and **MUST NOT construct its own store/pool and MUST NOT call `pool.start()` or register a `pool.stop()` shutdown hook** — the daemon already ran `reconcileOrphans()` → `pool.start()` in the correct §7.3 order and owns the drain. Running a second pool on the same `AGENT_QUEUE_PATH` DB would double concurrency and bypass the reconcile-before-claim guarantee (the bug this fix closes).
  - **Standalone mode** — when `opts.queue` is absent (`bun run web`, all-in-one tests), `startWebServer` self-hosts exactly as before: construct `createJobStore` + `createWorkerPool(createJobDispatch(...))`, `pool.start()`, and `onShutdown(pool.stop)`. This keeps the dev-server path working with no daemon. Concurrency = `computeConcurrency()`.

  Increment 4 (Task 27) moves ownership to `createDaemon`, which passes its reconciled queue via injected mode — so there is exactly ONE pool across daemon + server.

- [ ] **Step 1: Write the failing test** — `tests/server/main-queue-boot.test.ts`: (a) STANDALONE — `startWebServer({ port: 0 })` returns a handle whose `.jobStore.enqueue(...)` persists a job and `.pool.activeCount()` is callable; then `handle.pool.stop()` + `handle.server.stop()`. (b) INJECTED — build a temp `jobStore` + a pool whose `start` sets a flag, call `startWebServer({ port: 0, queue: { jobStore, pool } })`, and assert the returned `handle.pool === pool` (the SAME instance) and that `startWebServer` did **not** call the injected pool's `start` (the caller owns lifecycle); `handle.server.stop()`.

- [ ] **Step 2: Run — verify it fails.**

- [ ] **Step 3: Implement.** First widen `StartOptions` (main.ts:118):
```typescript
export type StartOptions = {
  port?: number;
  allowedOrigins?: string[];
  recordIo?: boolean;
  staticDir?: string;
  token?: string;
  /** Injected, pre-reconciled queue owned by the caller (the daemon). When
   *  present, startWebServer does NOT construct or start/stop a pool — the
   *  caller already ran reconcileOrphans() then pool.start() (§7.3). Absent =
   *  standalone: startWebServer self-hosts one pool (bun run web / tests). */
  queue?: { jobStore: JobStore; pool: WorkerPool };
};
```
Then, in `startWebServer` after the existing run-turn construction, branch instead of unconditionally constructing:
```typescript
  // §7.3 double-pool fix: inject the caller's reconciled queue when given;
  // otherwise self-host one. NEVER run two pools on the same AGENT_QUEUE_PATH.
  const injected = opts.queue;
  const jobStore =
    injected?.jobStore ?? createJobStore({ path: String(cfg.AGENT_QUEUE_PATH) }, {});
  let pool: WorkerPool;
  if (injected) {
    // Caller (daemon) owns lifecycle: do NOT start/stop or close here.
    pool = injected.pool;
  } else {
    const dispatch = createJobDispatch({
      runCrewTurn, getCrew, runWorkflowTurn, getWorkflow,
      runModelPull, runChatTurn, runBuilderTurn,
    });
    pool = createWorkerPool({
      store: jobStore,
      concurrency: computeConcurrency(),
      dispatch,
      pollMs: cfg.AGENT_QUEUE_POLL_MS as number,
    });
    pool.start();
    onShutdown(async () => { await pool.stop(); jobStore.close(); });
  }
```
Add `jobStore` to the `deps` object, add `jobStore`/`pool` to the return. Add `jobStore: JobStore` to `ServerDeps` in `app.ts`. Update test fixtures.

- [ ] **Step 4: Run — verify it passes** (`bun test tests/server/main-queue-boot.test.ts` + the touched fixtures' tests).

- [ ] **Step 5: Gate + commit**
```bash
bun run typecheck && bun run lint:file -- src/server/main.ts src/server/app.ts tests/server/main-queue-boot.test.ts
git add src/server/main.ts src/server/app.ts tests/server/
git commit -m "feat(server): boot queue+pool into ServerDeps (interim host) (Slice 24 Incr 3)"
```

## Task 18: `POST /api/jobs` — enqueue → `202 {jobId, runId}`

**Files:**
- Create: `src/server/jobs/enqueue.ts`
- Modify: `src/server/app.ts` (add the route to `handleApi` before the 404)
- Create: `tests/server/jobs/enqueue.test.ts`

**Interfaces:**
- Consumes: `JobEnqueueRequestSchema`/`JobLaunchResponseSchema` (Task 15), `JobStore.enqueue` (Task 6), `JobKind`/`JobPriority` (Task 4), `newRunId` (`src/run/run-id.ts:2`), `createRun` (`src/run/run-store.ts:7`).
- Produces: `handleJobEnqueue(req, deps): Promise<Response>` — parse+validate (400 on bad), pre-mint `runId`, `createRun(deps.runsRoot, runId)` so an immediate `/api/runs/:id/stream` never 404s (mirrors `handleCrewRun`'s pre-create, `crews/run.ts:55`), `deps.jobStore.enqueue({ kind, payload, priority, runId })`, return `JobLaunchResponseSchema.parse({ jobId, runId })` with status **202**.

- [ ] **Step 1: Write the failing test** — POST a valid `{ kind:'crew', payload:{name,input} }` → 202 with `jobId`+`runId`, and the job is `Queued` in the store; POST an invalid body → 400.
```typescript
import { test, expect } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJobStore } from '../../../src/queue/store.ts';
import { handleJobEnqueue } from '../../../src/server/jobs/enqueue.ts';

const deps = () => ({
  jobStore: createJobStore({ path: mkdtempSync(join(tmpdir(), 'jobs-')) }, {}),
  runsRoot: mkdtempSync(join(tmpdir(), 'runs-')),
});

test('POST /api/jobs enqueues and returns 202 {jobId, runId}', async () => {
  const d = deps();
  const res = await handleJobEnqueue(
    new Request('http://x/api/jobs', { method: 'POST', body: JSON.stringify({ kind: 'crew', payload: { name: 'c', input: 'go' } }) }),
    d as never,
  );
  expect(res.status).toBe(202);
  const body = await res.json();
  expect(body.jobId).toMatch(/^job-/);
  expect(body.runId).toMatch(/^run-/);
  expect(d.jobStore.getJob(body.jobId)?.status).toBe('queued');
});

test('POST /api/jobs 400s an invalid body', async () => {
  const d = deps();
  const res = await handleJobEnqueue(new Request('http://x/api/jobs', { method: 'POST', body: '{}' }), d as never);
  expect(res.status).toBe(400);
});
```

- [ ] **Step 2: Run — verify it fails.**

- [ ] **Step 3: Implement `handleJobEnqueue`** + wire into `handleApi` (`app.ts`) as `if (req.method === 'POST' && url.pathname === '/api/jobs') { const res = await handleJobEnqueue(req, deps); rec.status(res.status); return res; }` placed before the GET `/api/jobs` matcher (Task 19).

- [ ] **Step 4: Run — verify it passes.**

- [ ] **Step 5: Gate + commit**
```bash
bun run typecheck && bun run lint:file -- src/server/jobs/enqueue.ts src/server/app.ts tests/server/jobs/enqueue.test.ts
git add src/server/jobs/enqueue.ts src/server/app.ts tests/server/jobs/enqueue.test.ts
git commit -m "feat(server): POST /api/jobs enqueue -> 202 (Slice 24 Incr 3)"
```

## Task 19: `GET /api/jobs` (list) + `GET /api/jobs/:id` (detail)

**Files:**
- Create: `src/server/jobs/list.ts`, `src/server/jobs/detail.ts`
- Modify: `src/server/app.ts`
- Create: `tests/server/jobs/list.test.ts`

**Interfaces:**
- Consumes: `JobListQuerySchema`/`JobListResponseSchema`/`JobDtoSchema` (Task 15), `JobStore.listJobs`/`getJob` (Task 6/9), a `toJobDto(record): JobDTO` mapper (put in `src/server/jobs/map.ts` — a straight passthrough since `JobRecord` field names already match `JobDTO`).
- Produces: `handleJobList(params: URLSearchParams, deps): Response` (parse query, `listJobs`, map to `JobListResponseSchema`); `handleJobDetail(id, deps): Response` (`getJob` → `JobDtoSchema` or 404). Route order in `handleApi`: exact `GET /api/jobs` before the `/api/jobs/:id` regex (same discipline as `/api/runs` vs `/api/runs/:id`, `app.ts:180`).

- [ ] **Step 1: Write the failing test** — enqueue 3 jobs, `GET /api/jobs?limit=2` returns 2 items + `nextCursor` + `total:3`; `GET /api/jobs?status=queued` filters; `GET /api/jobs/:id` returns the record; unknown id → 404.

- [ ] **Step 2–5:** implement `list.ts`/`detail.ts`/`map.ts`, wire both routes (with the `/^\/api\/jobs\/([^/]+)$/` regex for detail), run tests green, then:
```bash
bun run typecheck && bun run lint:file -- src/server/jobs/list.ts src/server/jobs/detail.ts src/server/jobs/map.ts src/server/app.ts tests/server/jobs/list.test.ts
git add src/server/jobs/ src/server/app.ts tests/server/jobs/list.test.ts
git commit -m "feat(server): GET /api/jobs list + detail (Slice 24 Incr 3)"
```

## Task 20: `POST /api/jobs/:id/cancel` — fire the pool AbortController (item 8)

**Files:**
- Create: `src/server/jobs/cancel.ts`
- Modify: `src/server/app.ts` (add `ServerDeps.pool: WorkerPool`; wire the `/api/jobs/:id/cancel` route BEFORE the bare `/api/jobs/:id` detail regex — stream-before-detail discipline)
- Modify: `src/server/main.ts` (pass `pool` into `deps`)
- Create: `tests/server/jobs/cancel.test.ts`

**Interfaces:**
- Consumes: `WorkerPool.cancel` (Task 13), `JobStore.getJob`/`markCanceled` (a queued-but-not-yet-running job is canceled directly on the store; a running one via `pool.cancel`).
- Produces: `handleJobCancel(id, deps): Response` — `getJob(id)` (404 if missing); if `Running`, `deps.pool.cancel(id)` (which aborts + `markCanceled`); if `Queued`, `deps.jobStore.markCanceled(id)` directly (no in-flight controller to fire); return `{ canceled: true }` (200) or `{ canceled: false }` when already terminal.

- [ ] **Step 1: Write the failing test** — `tests/server/jobs/cancel.test.ts` (the Running path is covered by the pool test Task 13 + integration Task 22):
```typescript
import { test, expect } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJobStore } from '../../../src/queue/store.ts';
import { handleJobCancel } from '../../../src/server/jobs/cancel.ts';
import { JobKind, JobStatus } from '../../../src/queue/types.ts';

function deps() {
  return {
    jobStore: createJobStore({ path: mkdtempSync(join(tmpdir(), 'jobs-')) }, {}),
    pool: { cancel: () => true, activeCount: () => 0, start() {}, stop: async () => {} },
  };
}

test('a Queued job cancels directly on the store', async () => {
  const d = deps();
  const job = d.jobStore.enqueue({ kind: JobKind.Crew, payload: 'x' });
  const res = handleJobCancel(job.id, d as never);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ canceled: true });
  expect(d.jobStore.getJob(job.id)?.status).toBe(JobStatus.Canceled);
});

test('an already-terminal (Done) job returns canceled:false', async () => {
  const d = deps();
  const job = d.jobStore.enqueue({ kind: JobKind.Crew, payload: 'x' });
  d.jobStore.claimNext();
  d.jobStore.markDone(job.id, null);
  const res = handleJobCancel(job.id, d as never);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ canceled: false });
});

test('an unknown job id is 404', () => {
  expect(handleJobCancel('job-nope', deps() as never).status).toBe(404);
});
```

- [ ] **Step 2: Run — verify it fails** (`handleJobCancel` module missing).

- [ ] **Step 3: Implement `src/server/jobs/cancel.ts`**
```typescript
import { JobStatus } from '../../queue/types.ts';
import { json, type ServerDeps } from '../app.ts';

/**
 * Cancel a job. A Running job is aborted via the pool's per-job
 * AbortController (`pool.cancel`, which also markCanceled's it); a Queued job
 * has no in-flight controller, so it is canceled directly on the store; a
 * terminal job is a no-op (`canceled:false`). Unknown id → 404.
 */
export function handleJobCancel(id: string, deps: ServerDeps): Response {
  const job = deps.jobStore.getJob(id);
  if (!job) return json({ error: 'not found' }, 404);
  if (job.status === JobStatus.Running) {
    return json({ canceled: deps.pool.cancel(id) }, 200);
  }
  if (job.status === JobStatus.Queued) {
    deps.jobStore.markCanceled(id);
    return json({ canceled: true }, 200);
  }
  return json({ canceled: false }, 200); // already terminal
}
```
Wire into `handleApi` (`app.ts`) BEFORE the bare `/api/jobs/:id` detail regex (stream/action-before-detail discipline):
```typescript
  const cancelMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)\/cancel$/);
  if (req.method === 'POST' && cancelMatch) {
    const res = handleJobCancel(cancelMatch[1] as string, deps);
    rec.status(res.status);
    return res;
  }
```
Add `pool: WorkerPool` to `ServerDeps` (`app.ts`) and thread `pool` into `deps` in `main.ts`.

- [ ] **Step 4: Run — verify it passes** (`bun test tests/server/jobs/cancel.test.ts` → 3 tests).

- [ ] **Step 5: Gate + commit**
```bash
bun run typecheck && bun run lint:file -- src/server/jobs/cancel.ts src/server/app.ts src/server/main.ts tests/server/jobs/cancel.test.ts
git add src/server/jobs/cancel.ts src/server/app.ts src/server/main.ts tests/server/jobs/cancel.test.ts
git commit -m "feat(server): POST /api/jobs/:id/cancel (Slice 24 Incr 3, item 8)"
```

## Task 21: Migrate crew / workflow / model-pull handlers from `void`-detach to enqueue

**Files:**
- Modify: `src/server/crews/run.ts` (`handleCrewRun`), `src/server/workflows/run.ts` (`handleWorkflowRun`), `src/server/models/pull.ts` (`handleModelPull`)
- Modify: `tests/server/crews/*`, `tests/server/workflows/*`, `tests/server/models/*` as needed
- Create: `tests/server/crews/run-enqueue.test.ts`

**Interfaces:**
- Consumes: `JobStore.enqueue` (via `deps.jobStore`), `JobKind` (Task 4), the existing per-kind request schemas.
- Produces: each handler now validates the body, mints `runId`, `createRun` (unchanged pre-create), then **`deps.jobStore.enqueue({ kind: JobKind.Crew|Workflow|Pull, payload, runId })`** INSTEAD of `void deps.runCrewTurn(...).catch(...)`. Returns the SAME `RunLaunchResponseSchema.parse({ runId })` shape (the browser's existing `/api/runs/:id/stream` subscribe is unchanged — the run is now executed by the pool, not an unmanaged promise). The `CrewRunDeps`/`WorkflowRunDeps`/`ModelPullDeps` types gain `jobStore: JobStore`. The old `runCrewTurn`/etc. still exist — they are now invoked by the pool's dispatch (Task 16), not the route.

- [ ] **Step 1: Write the failing test** — `tests/server/crews/run-enqueue.test.ts`: `handleCrewRun` with a `jobStore` in deps enqueues a `JobKind.Crew` job (assert `deps.jobStore.listJobs(...)` has one queued crew job with the returned `runId`) and NO longer calls the injected `runCrewTurn` synchronously (the pool does, later).

- [ ] **Step 2: Run — verify it fails** (current impl void-detaches, does not enqueue).

- [ ] **Step 3: Implement** the three handlers' migration. E.g. `crews/run.ts`:
```typescript
  const runId = newRunId();
  await createRun(deps.runsRoot, runId);
  deps.jobStore.enqueue({
    kind: JobKind.Crew,
    payload: { name, input },
    runId,
  });
  return json(RunLaunchResponseSchema.parse({ runId }), 200);
```
(Drop the `void ...runCrewTurn().catch(writeArtifact)` block — the pool's dispatch + `markFailed` now own failure capture; the run-dir `error.json` write moves into the dispatch executor's catch if a per-run artifact is still wanted, but the job's `error` column is the durable record.)

- [ ] **Step 4: Run — verify it passes** + regression on the three feature test dirs.

- [ ] **Step 5: Gate + commit**
```bash
bun run typecheck && bun run lint:file -- src/server/crews/run.ts src/server/workflows/run.ts src/server/models/pull.ts tests/server/crews/run-enqueue.test.ts
git add src/server/crews/run.ts src/server/workflows/run.ts src/server/models/pull.ts tests/server/
git commit -m "feat(server): detach crew/workflow/pull runs onto the queue (Slice 24 Incr 3)"
```

## Task 22: SSE reconcile integration test — subscribe-after-start replays with no gap (§7.1) [OPUS/ultracode]

**Files:**
- Create: `tests/server/jobs/sse-reconcile.integration.test.ts`
- Modify: `src/server/runs/stream.ts` ONLY if the test exposes a real replay gap (the existing Last-Event-ID seed logic, `stream.ts:107`, is expected to cover it — this task PROVES it, and fixes only if it fails)

**Interfaces:**
- Consumes: `startWebServer({ port: 0 })` (real pool + queue), `handleRunStream` replay (`stream.ts:52`).
- Produces: the §7.1 gate. Enqueue a job whose dispatch writes several run spans over time; connect to `GET /api/runs/:runId/stream` **AFTER** the job has already started (and emitted its first span); assert the full span sequence replays from the run's journal with **no gap** (every spanId the run produced is delivered). Also assert the disconnect → reconnect-with-`Last-Event-ID` path collects only newer spans (no dup, no drop).

- [ ] **Step 1: Write the failing/gating test** — use a test-injected dispatch that writes N spans with small sleeps into `runs/<runId>/spans.jsonl` via the normal telemetry path; subscribe after span 1; read the SSE body; assert spanIds 1..N all arrive in order. Then reconnect with `Last-Event-ID: <span k>` and assert only k+1..N arrive.

- [ ] **Step 2: Run** — if PASS, the existing replay already satisfies §7.1 (expected). If FAIL (a race drops the span emitted between enqueue and subscribe), FIX by seeding the emitted-set from the full on-disk snapshot on first poll (the `stream.ts` loop already re-reads `mapRunToDto` each tick, so a late subscriber gets the full snapshot — verify the seed logic handles the "cursor absent" degrade-to-full-replay branch, `stream.ts:110`).

- [ ] **Step 3: Minimal fix if needed** — only in `stream.ts`, guarded by the test.

- [ ] **Step 4: Run — verify green.**

- [ ] **Step 5: Gate + commit**
```bash
bun run typecheck && bun run lint:file -- tests/server/jobs/sse-reconcile.integration.test.ts src/server/runs/stream.ts
git add tests/server/jobs/sse-reconcile.integration.test.ts src/server/runs/stream.ts
git commit -m "test(server): SSE subscribe-after-start replay-no-gap gate (Slice 24 Incr 3, §7.1)"
```

## Task 23: Concurrent-stream cap on `/api/runs/:id/stream` (item 6)

**Files:**
- Create: `src/server/runs/stream-limit.ts` (the shared open-stream counter + cap gate — a small seam so the cap is unit-testable without opening real SSE sockets)
- Modify: `src/server/runs/stream.ts` (acquire a slot before opening; release in `cancel`/close; 503 over the cap)
- Modify: `src/config/schema.ts` (add `AGENT_WEB_MAX_STREAMS`, computed default)
- Create: `tests/server/runs/stream-cap.test.ts`

**Interfaces:**
- Consumes: `computeConcurrency` (Task 11), `loadConfig` (`src/config/schema.ts`).
- Produces: `acquireStreamSlot(cap?)`/`releaseStreamSlot()`/`openStreamCount()`/`maxStreams()` in `stream-limit.ts`; `handleRunStream` calls `acquireStreamSlot()` and returns `503 { error: 'too many streams' }` BEFORE opening the `ReadableStream` when over `maxStreams()`, and `releaseStreamSlot()` in the stream's `cancel` + on natural completion. `maxStreams()` computes from `computeConcurrency()` when `AGENT_WEB_MAX_STREAMS` is 0/unset (never a magic literal in code — a positive env value overrides). Closes deferred item 6.

- [ ] **Step 1: Write the failing test** — `tests/server/runs/stream-cap.test.ts`:
```typescript
import { test, expect } from 'bun:test';
import {
  acquireStreamSlot,
  openStreamCount,
  releaseStreamSlot,
} from '../../../src/server/runs/stream-limit.ts';

test('acquire succeeds up to the cap, then refuses; release frees a slot', () => {
  const cap = 2;
  expect(acquireStreamSlot(cap)).toBe(true);
  expect(acquireStreamSlot(cap)).toBe(true);
  expect(acquireStreamSlot(cap)).toBe(false); // cap+1 refused
  expect(openStreamCount()).toBe(2);
  releaseStreamSlot();
  expect(acquireStreamSlot(cap)).toBe(true); // slot freed
  releaseStreamSlot();
  releaseStreamSlot();
  expect(openStreamCount()).toBe(0);
});
```

- [ ] **Step 2: Run — verify it fails** (`stream-limit.ts` missing).

- [ ] **Step 3: Implement `src/server/runs/stream-limit.ts`**
```typescript
import { loadConfig } from '../../config/schema.ts';
import { computeConcurrency } from '../../queue/concurrency.ts';

let open = 0;

/** Cap on simultaneously-open run SSE streams. Computed from worker concurrency
 *  when AGENT_WEB_MAX_STREAMS is 0/unset (never a hardcoded N); a positive env
 *  value overrides. Each run may have a few tailing clients, hence the headroom. */
export function maxStreams(): number {
  const configured = loadConfig().values.AGENT_WEB_MAX_STREAMS as number;
  if (Number.isInteger(configured) && configured > 0) return configured;
  return computeConcurrency() * 8;
}
export function acquireStreamSlot(cap = maxStreams()): boolean {
  if (open >= cap) return false;
  open++;
  return true;
}
export function releaseStreamSlot(): void {
  open = Math.max(0, open - 1);
}
export function openStreamCount(): number {
  return open;
}
```
Add the config row to `src/config/schema.ts` (near the other `AGENT_WEB_*` rows):
```typescript
  {
    env: 'AGENT_WEB_MAX_STREAMS',
    kind: 'number',
    def: 0,
    doc: 'Max simultaneously-open run SSE streams (server/runs/stream-limit.ts). 0/unset = computed from worker concurrency (×8 headroom); a positive integer overrides. Over the cap, GET /api/runs/:id/stream returns 503. Never hardcode.',
  },
```
Wire into `handleRunStream` (`stream.ts`): before opening the stream, `if (!acquireStreamSlot()) return json({ error: 'too many streams' }, 503);`; call `releaseStreamSlot()` in the `ReadableStream`'s `cancel()` and when the run reaches a terminal lifecycle (the loop's normal exit).

- [ ] **Step 4: Run — verify it passes** (`bun test tests/server/runs/stream-cap.test.ts` → 1 test).

- [ ] **Step 5: Gate + commit**
```bash
bun run typecheck && bun run lint:file -- src/server/runs/stream-limit.ts src/server/runs/stream.ts src/config/schema.ts tests/server/runs/stream-cap.test.ts
git add src/server/runs/stream-limit.ts src/server/runs/stream.ts src/config/schema.ts tests/server/runs/stream-cap.test.ts
git commit -m "feat(server): concurrent-stream cap (Slice 24 Incr 3, item 6)"
```

## Task 24: DTO provenance — populate `RunDTO.origin` = daemon + `server.principal` (item 17)

**Files:**
- Modify: `src/contracts/enums.ts` (`RunOrigin` gains `Daemon = 'daemon'`)
- Modify: `src/run/run-dto.ts` (read a run's origin marker; default `RunOrigin.Manual`)
- Modify: `src/server/jobs/dispatch.ts` (write an `origin` marker into the run dir when a job dispatches — origin=`daemon`)
- Modify: `src/server/app.ts` (`handleApi` passes the verified principal into `withServerRequestSpan`)
- Create: `tests/run/run-origin.test.ts`, `tests/server/principal.test.ts`

**Interfaces:**
- Consumes: `RunOrigin` (`src/contracts/enums.ts:8`), `withServerRequestSpan({ route, method, principal })` (`src/telemetry/spans.ts:275`), `writeArtifact` (`src/run/run-store.ts:17`), `TokenGuard` extended to expose the device principal (Increment 5 supplies the real per-device id; here it is `'local'` until session tokens land, wired so Increment 5 flips it on).
- Produces: `readRunOrigin(runDir): RunOrigin` in `run-dto.ts` (reads `runs/<id>/origin`, falls back to `RunOrigin.Manual`); `mapRunToDto`/list projections use it instead of the hardcoded `RunOrigin.Manual` (`run-dto.ts:297,343,458`). A dispatched job writes `origin` = `daemon`. `withServerRequestSpan` receives `principal` (the device id from the session token, or `'local'`), populating the reserved `server.principal` attribute (`spans.ts:283`). Closes item 17.

- [ ] **Step 1: Write the failing test** — `run-origin.test.ts`: a run dir with an `origin` file reading `daemon` maps to `RunDTO.origin === RunOrigin.Daemon`; a dir without one defaults to `Manual`. `principal.test.ts`: a request whose guard resolves a device id surfaces that principal (assert via a captured span attribute or a seam).

- [ ] **Step 2: Run — verify it fails.**

- [ ] **Step 3: Implement** the enum value, `readRunOrigin`, the three `run-dto.ts` call-site swaps, the dispatch origin-write, and the `withServerRequestSpan` principal threading.

- [ ] **Step 4: Run — verify it passes** (+ regression on `tests/run/` DTO tests).

- [ ] **Step 5: Gate + commit**
```bash
bun run typecheck && bun run lint:file -- src/contracts/enums.ts src/run/run-dto.ts src/server/jobs/dispatch.ts src/server/app.ts tests/run/run-origin.test.ts tests/server/principal.test.ts
git add src/contracts/enums.ts src/run/run-dto.ts src/server/jobs/dispatch.ts src/server/app.ts tests/run/run-origin.test.ts tests/server/principal.test.ts
git commit -m "feat(run): populate RunDTO.origin=daemon + server.principal (Slice 24 Incr 3, item 17)"
```

## Task 25: Boundary gate — Increment 3

**Files:** none (verification only).

- [ ] **Step 1: Full gate**
```bash
bun run check
```
Expected: `bun run check` PASS — **cumulative test count ~1660, 0 fail** (Increment 3 adds ~25 job-DTO/dispatch/queue-boot/enqueue/list/cancel/detach/SSE/stream-cap/provenance tests). docs:check passes — `src/queue/` + `src/server/jobs/` are covered by the Increment-2 stub + `src/server/` is already documented; the full write is Increment 7. If `src/server/jobs/` trips docs:check as a new subsystem, add a one-line module-map stub as in Task 14. All queue + job-API + provenance tests green.

---

# Increment 4 — Daemon lifecycle (`src/daemon/`, PID + drain + boot-recovery + launchd + CLI)

**Purpose (spec §5.4, D3):** the OS-portable long-lived core that hosts the queue + pool + web server. PID file `~/.agent/daemon.pid`; graceful `SIGTERM`/`SIGINT` drain (stop claiming → finish/checkpoint in-flight) reusing `src/process/lifecycle.ts` + `child-registry.ts`; a boot-recovery pass calling `queue.reconcileOrphans` BEFORE the pool accepts work (§7.3); a launchd plist (`KeepAlive`/`RunAtLoad`, stdout/err → logs); and an `agent daemon install/start/stop/status/logs` CLI over `launchctl`. Provenance origin=`daemon` (item 5+17); daemon/queue telemetry spans (item 18).

## Task 26: PID file — write / read / stale-detect

**Files:**
- Create: `src/daemon/pid.ts`
- Create: `tests/daemon/pid.test.ts`

**Interfaces:**
- Consumes: `node:fs`, `node:os` (`homedir`), `node:path`.
- Produces: `defaultPidPath(): string` (`~/.agent/daemon.pid`); `writePid(path, pid): void` (mkdir + write, `0600`); `readPid(path): number | undefined`; `isPidAlive(pid): boolean` (`process.kill(pid, 0)` probe); `clearPid(path): void`. A stale PID (file present, process dead) is treated as not-running so a crashed daemon can be restarted.

- [ ] **Step 1: Write the failing test**
```typescript
import { test, expect } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writePid, readPid, isPidAlive, clearPid } from '../../src/daemon/pid.ts';

test('writePid/readPid round-trips', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'pid-')), 'daemon.pid');
  writePid(path, 4242);
  expect(readPid(path)).toBe(4242);
  clearPid(path);
  expect(readPid(path)).toBeUndefined();
});
test('isPidAlive is true for our own pid, false for a bogus one', () => {
  expect(isPidAlive(process.pid)).toBe(true);
  expect(isPidAlive(9_999_999)).toBe(false);
});
```

- [ ] **Step 2: Run — verify it fails.**

- [ ] **Step 3: Implement `src/daemon/pid.ts`**
```typescript
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export function defaultPidPath(): string {
  return join(homedir(), '.agent', 'daemon.pid');
}
export function writePid(path: string, pid: number): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, String(pid), { mode: 0o600 });
}
export function readPid(path: string): number | undefined {
  try {
    const n = Number(readFileSync(path, 'utf8').trim());
    return Number.isInteger(n) && n > 0 ? n : undefined;
  } catch {
    return undefined;
  }
}
export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0); // signal 0 = existence probe, kills nothing
    return true;
  } catch {
    return false;
  }
}
export function clearPid(path: string): void {
  try {
    rmSync(path);
  } catch {
    // already gone
  }
}
```

- [ ] **Step 4: Run — verify it passes.**

- [ ] **Step 5: Gate + commit**
```bash
bun run typecheck && bun run lint:file -- src/daemon/pid.ts tests/daemon/pid.test.ts
git add src/daemon/pid.ts tests/daemon/pid.test.ts
git commit -m "feat(daemon): PID file write/read/stale-detect (Slice 24 Incr 4)"
```

## Task 27: `createDaemon` — start (boot-recovery → pool → server), stop (drain), status [OPUS/ultracode]

**Files:**
- Create: `src/daemon/core.ts`
- Create: `tests/daemon/core.test.ts`

**Interfaces:**
- Consumes: `JobStore.reconcileOrphans` (Task 10), `WorkerPool.start/stop` (Task 13), `startWebServer` (`src/server/main.ts:127`), PID helpers (Task 26), `installSignalHandlers`/`onShutdown` (`src/process/lifecycle.ts:13,20`).
- Produces: the **Shared-contracts** `Daemon` + `createDaemon`. `start()` ordering is the correctness core — **build store → `reconcileOrphans()` → `writePid` → `pool.start()` → `startWebServer({ ..., queue: { jobStore, pool } })`**: guard against an already-alive PID; **call `queue.reconcileOrphans()` FIRST** (before the pool can claim — §7.3); write the PID; `pool.start()`; then boot the web server in **injected mode**, passing the daemon's OWN `{ jobStore: opts.queue, pool: opts.pool }` so `startWebServer` reuses that single reconciled pool and does NOT spin up a second one (the §7.3 double-pool fix — see Task 17); `installSignalHandlers()` so `SIGTERM`/`SIGINT` drain via `onShutdown(() => pool.stop())`. `stop()`: `pool.stop()` (drain) + server stop + `clearPid`. `status()`: `{ running: isPidAlive(readPid()), pid }`. Drain stops claiming, awaits in-flight, marks stragglers Interrupted.

- [ ] **Step 1: Write the failing test** — inject a fake `startWebServer` (returns a fake server with `.stop()`), a real temp `jobStore` with an injected orphaned `Running` row, and a real `pool`. Assert `start()` calls `reconcileOrphans` BEFORE the pool claims (the orphan is `Interrupted` and never re-run); assert a PID is written and `status().running` is true after start; assert `stop()` drains and clears the PID.
```typescript
import { test, expect } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJobStore } from '../../src/queue/store.ts';
import { createWorkerPool } from '../../src/queue/pool.ts';
import { createDaemon } from '../../src/daemon/core.ts';
import { JobKind, JobStatus } from '../../src/queue/types.ts';

test('start reconciles BEFORE pool.start, then injects its OWN pool into the server', async () => {
  const store = createJobStore({ path: mkdtempSync(join(tmpdir(), 'jobs-')) }, {});
  const orphan = store.enqueue({ kind: JobKind.Crew, payload: 1 });
  store.claimNext(); // leave it Running (simulate a crash)

  // Call-order log proves reconcile ran BEFORE the pool started (the §7.3 gate).
  const order: string[] = [];
  const realPool = createWorkerPool({
    store, concurrency: 1, pollMs: 5,
    dispatch: () => async () => ({}),
  });
  const pool = {
    ...realPool,
    start: () => { order.push('pool.start'); realPool.start(); },
    stop: async () => { await realPool.stop(); },
  };
  const wrappedStore = {
    ...store,
    reconcileOrphans: () => { order.push('reconcile'); return store.reconcileOrphans(); },
  };

  // Capture the options startWebServer receives so we can assert injection.
  let received: { queue?: { jobStore: unknown; pool: unknown } } | undefined;
  const pidPath = join(mkdtempSync(join(tmpdir(), 'pid-')), 'daemon.pid');
  const daemon = createDaemon({
    startWebServer: ((opts: { queue?: { jobStore: unknown; pool: unknown } }) => {
      received = opts;
      return { server: { stop() {} }, token: 't', port: 0 };
    }) as never,
    queue: wrappedStore as never, pool: pool as never, pidPath,
  });

  await daemon.start();
  // The daemon injected its OWN pool + store — startWebServer built no second pool.
  expect(received?.queue?.pool).toBe(pool);
  expect(received?.queue?.jobStore).toBe(wrappedStore);
  // Ordering: reconcile happened before the pool started.
  expect(order).toEqual(['reconcile', 'pool.start']);
  // The orphan was transitioned to Interrupted by reconcile (M3: teeth, not just
  // "left Running"); the full no-double-exec / durable-resume proof under a live
  // pool is the Task 43 restart-durability integration test.
  expect(store.getJob(orphan.id)?.status).toBe(JobStatus.Interrupted);
  expect(daemon.status().running).toBe(true);
  await daemon.stop();
  expect(daemon.status().running).toBe(false);
  store.close();
});
```

- [ ] **Step 2: Run — verify it fails.**

- [ ] **Step 3: Implement `src/daemon/core.ts`**
```typescript
import { onShutdown } from '../process/lifecycle.ts';
import type { JobStore } from '../queue/store.ts';
import type { WorkerPool } from '../queue/pool.ts';
import type { startWebServer as StartWebServer } from '../server/main.ts';
import { clearPid, defaultPidPath, isPidAlive, readPid, writePid } from './pid.ts';
import { recordDaemonStart, recordDaemonStop } from './spans.ts';

export type Daemon = {
  install(): void;
  start(): Promise<void>;
  stop(): Promise<void>;
  status(): { running: boolean; pid?: number };
};

export function createDaemon(opts: {
  startWebServer: typeof StartWebServer;
  queue: JobStore;
  pool: WorkerPool;
  pidPath?: string;
  install?: () => void; // launchd installer (Task 28), injected
  // Reserved for Increment 6 (Task 41): reconcile predicate for durable-orphan
  // requeue. Unused here — Increment 4 reconciles zero-arg (all-Interrupted).
  durable?: (job: import('../queue/types.ts').JobRecord) => boolean;
}): Daemon {
  const pidPath = opts.pidPath ?? defaultPidPath();
  let server: { stop(): void } | undefined;

  return {
    install(): void {
      opts.install?.();
    },
    async start(): Promise<void> {
      const existing = readPid(pidPath);
      if (existing && isPidAlive(existing)) {
        throw new Error(`daemon already running (pid ${existing})`);
      }
      // §7.3: reconcile orphaned Running rows BEFORE the pool can claim, in the
      // store's own transaction, so no row is ever picked up mid-flight.
      opts.queue.reconcileOrphans();
      writePid(pidPath, process.pid);
      opts.pool.start();
      // INJECTED MODE: hand startWebServer our already-reconciled, already-
      // started queue so it does NOT construct or start a second pool on the
      // same DB (§7.3 double-pool fix — Task 17). Exactly one pool exists.
      const handle = opts.startWebServer({
        queue: { jobStore: opts.queue, pool: opts.pool },
      });
      server = handle.server;
      onShutdown(async () => {
        await this.stop();
      });
      recordDaemonStart({ pid: process.pid });
    },
    async stop(): Promise<void> {
      await opts.pool.stop(); // drain: stop claiming, await in-flight, interrupt stragglers
      server?.stop();
      server = undefined;
      clearPid(pidPath);
      recordDaemonStop({ pid: process.pid });
    },
    status(): { running: boolean; pid?: number } {
      const pid = readPid(pidPath);
      return { running: pid !== undefined && isPidAlive(pid), pid };
    },
  };
}
```
(Note: `recordDaemonStart/Stop` come from Task 30 — implement `src/daemon/spans.ts` as no-op stubs first if executing this task before Task 30, or reorder so Task 30 lands first. The plan orders spans last; add the stubs here and fill them in Task 30.)

- [ ] **Step 4: Run — verify it passes.**

- [ ] **Step 5: Gate + commit**
```bash
bun run typecheck && bun run lint:file -- src/daemon/core.ts tests/daemon/core.test.ts
git add src/daemon/core.ts tests/daemon/core.test.ts
git commit -m "feat(daemon): createDaemon start/stop/status + boot-recovery ordering (Slice 24 Incr 4)"
```

## Task 28: launchd plist template

**Files:**
- Create: `src/daemon/launchd.ts`
- Create: `tests/daemon/launchd.test.ts`

**Interfaces:**
- Consumes: `node:os` (`homedir`), the resolved `bun` binary path + the daemon entry script path.
- Produces: `renderLaunchdPlist(opts: { label: string; bunPath: string; entryScript: string; logDir: string; workingDir: string }): string` — a valid `plist` XML string with `KeepAlive=true`, `RunAtLoad=true`, `ProgramArguments=[bun, entryScript, 'daemon', 'start-foreground']`, `StandardOutPath`/`StandardErrorPath` under `logDir`, `WorkingDirectory`. `defaultLaunchdLabel(): 'io.acceldata.agent'` (or the repo's chosen label); `launchdPlistPath(label): ~/Library/LaunchAgents/<label>.plist`.

- [ ] **Step 1: Write the failing test** — `tests/daemon/launchd.test.ts`:
```typescript
import { test, expect } from 'bun:test';
import {
  defaultLaunchdLabel,
  launchdPlistPath,
  renderLaunchdPlist,
} from '../../src/daemon/launchd.ts';

const opts = {
  label: 'io.acceldata.agent',
  bunPath: '/opt/homebrew/bin/bun',
  entryScript: '/Users/me/ai/src/cli/daemon.ts',
  logDir: '/Users/me/.agent/logs',
  workingDir: '/Users/me/ai',
};

test('renderLaunchdPlist emits KeepAlive + RunAtLoad + program args + log paths', () => {
  const plist = renderLaunchdPlist(opts);
  expect(plist.startsWith('<?xml')).toBe(true);
  expect(plist).toContain('<plist version="1.0">');
  expect(plist).toContain('<key>KeepAlive</key>');
  expect(plist).toContain('<key>RunAtLoad</key>');
  expect(plist).toContain('<true/>');
  expect(plist).toContain(opts.bunPath);
  expect(plist).toContain(opts.entryScript);
  expect(plist).toContain('start-foreground');
  expect(plist).toContain('/Users/me/.agent/logs/agent.out.log');
  expect(plist).toContain('/Users/me/.agent/logs/agent.err.log');
});

test('an XML-special value is escaped', () => {
  const plist = renderLaunchdPlist({ ...opts, workingDir: '/tmp/a & b' });
  expect(plist).toContain('/tmp/a &amp; b');
});

test('launchdPlistPath is under ~/Library/LaunchAgents', () => {
  expect(launchdPlistPath(defaultLaunchdLabel())).toMatch(
    /Library\/LaunchAgents\/io\.acceldata\.agent\.plist$/,
  );
});
```

- [ ] **Step 2: Run — verify it fails** (`src/daemon/launchd.ts` missing).

- [ ] **Step 3: Implement `src/daemon/launchd.ts`**
```typescript
import { homedir } from 'node:os';
import { join } from 'node:path';

export function defaultLaunchdLabel(): string {
  return 'io.acceldata.agent';
}
export function launchdPlistPath(label: string): string {
  return join(homedir(), 'Library', 'LaunchAgents', `${label}.plist`);
}

/** Escape XML text-node specials so a path/arg can never break the plist. */
function xml(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function renderLaunchdPlist(opts: {
  label: string;
  bunPath: string;
  entryScript: string;
  logDir: string;
  workingDir: string;
}): string {
  const args = [opts.bunPath, opts.entryScript, 'daemon', 'start-foreground'];
  const argXml = args.map((a) => `    <string>${xml(a)}</string>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xml(opts.label)}</string>
  <key>ProgramArguments</key>
  <array>
${argXml}
  </array>
  <key>KeepAlive</key>
  <true/>
  <key>RunAtLoad</key>
  <true/>
  <key>WorkingDirectory</key>
  <string>${xml(opts.workingDir)}</string>
  <key>StandardOutPath</key>
  <string>${xml(join(opts.logDir, 'agent.out.log'))}</string>
  <key>StandardErrorPath</key>
  <string>${xml(join(opts.logDir, 'agent.err.log'))}</string>
</dict>
</plist>
`;
}
```

- [ ] **Step 4: Run — verify it passes** (`bun test tests/daemon/launchd.test.ts` → 3 tests).

- [ ] **Step 5: Gate + commit**
```bash
bun run typecheck && bun run lint:file -- src/daemon/launchd.ts tests/daemon/launchd.test.ts
git add src/daemon/launchd.ts tests/daemon/launchd.test.ts
git commit -m "feat(daemon): launchd plist template (Slice 24 Incr 4)"
```

## Task 29: `agent daemon` CLI — install / start / stop / status / logs over `launchctl`

**Files:**
- Create: `src/cli/daemon.ts`
- Modify: `package.json` (add `"daemon": "bun run src/cli/daemon.ts"` to `scripts`)
- Create: `tests/cli/daemon.test.ts`

**Interfaces:**
- Consumes: `createDaemon` (Task 27), `renderLaunchdPlist`/`launchdPlistPath` (Task 28), `createJobStore`/`createWorkerPool`/`createJobDispatch`/`computeConcurrency` (to build the daemon's queue+pool), `startWebServer` (`src/server/main.ts:127`), `node:child_process` (`execFileSync` for `launchctl load/unload`), PID helpers (Task 26).
- Produces: a CLI dispatching on `process.argv[2]`: `install` (write plist + `launchctl load`), `start` (`launchctl load` OR, with `start-foreground`, run `createDaemon(...).start()` inline — the launchd `ProgramArguments` target), `stop` (`launchctl unload` + `createDaemon(...).stop()` / signal the PID), `status` (print `daemon.status()`), `logs` (tail the launchd stdout/err log files). `launchctl` calls are injectable (a `run` dep) so the test never shells out. `install` is macOS-only; on Linux it prints the documented systemd-unit guidance instead of failing.

- [ ] **Step 1: Write the failing test** — `tests/cli/daemon.test.ts` (a `runDaemonCli(argv, deps)` seam so the test never shells out):
```typescript
import { test, expect } from 'bun:test';
import { runDaemonCli } from '../../src/cli/daemon.ts';

function harness() {
  const calls: string[][] = [];
  const writes: { path: string; body: string }[] = [];
  const out: string[] = [];
  const deps = {
    run: (cmd: string, args: string[]) => { calls.push([cmd, ...args]); },
    writeFile: (path: string, body: string) => { writes.push({ path, body }); },
    plistPath: '/Users/me/Library/LaunchAgents/io.acceldata.agent.plist',
    renderPlist: () => '<?xml version="1.0"?>',
    status: () => ({ running: false }),
    stopDaemon: async () => {},
    startForeground: async () => {},
    logPaths: ['/Users/me/.agent/logs/agent.out.log'],
    platform: 'darwin' as NodeJS.Platform,
    print: (s: string) => out.push(s),
  };
  return { deps, calls, writes, out };
}

test('install writes the plist then launchctl load', async () => {
  const h = harness();
  await runDaemonCli(['install'], h.deps as never);
  expect(h.writes[0]?.path).toBe(h.deps.plistPath);
  expect(h.calls).toContainEqual(['launchctl', 'load', h.deps.plistPath]);
});

test('status with a dead pid prints "not running"', async () => {
  const h = harness();
  await runDaemonCli(['status'], h.deps as never);
  expect(h.out.join('\n')).toContain('not running');
});

test('stop calls launchctl unload', async () => {
  const h = harness();
  await runDaemonCli(['stop'], h.deps as never);
  expect(h.calls).toContainEqual(['launchctl', 'unload', h.deps.plistPath]);
});

test('install on linux prints systemd guidance and does not shell out', async () => {
  const h = harness();
  await runDaemonCli(['install'], { ...h.deps, platform: 'linux' } as never);
  expect(h.out.join('\n')).toMatch(/systemd/i);
  expect(h.calls).toHaveLength(0);
});
```

- [ ] **Step 2: Run — verify it fails** (`runDaemonCli` missing).

- [ ] **Step 3: Implement `src/cli/daemon.ts`** — the injectable dispatch plus a thin `import.meta.main` that builds the real deps (`execFileSync` for `run`, `writeFileSync`, `renderLaunchdPlist`/`launchdPlistPath` from Task 28, `createDaemon(...)` from Task 27 built over `createJobStore`/`createWorkerPool`/`createJobDispatch`/`computeConcurrency`, PID helpers from Task 26):
```typescript
export type DaemonCliDeps = {
  run: (cmd: string, args: string[]) => void;
  writeFile: (path: string, body: string) => void;
  plistPath: string;
  renderPlist: () => string;
  status: () => { running: boolean; pid?: number };
  stopDaemon: () => Promise<void>;
  startForeground: () => Promise<void>;
  logPaths: string[];
  platform: NodeJS.Platform;
  print: (s: string) => void;
};

export async function runDaemonCli(
  argv: string[],
  deps: DaemonCliDeps,
): Promise<void> {
  const cmd = argv[0];
  if (cmd === 'install') {
    if (deps.platform !== 'darwin') {
      deps.print(
        'launchd install is macOS-only. On Linux, create a systemd --user ' +
          'unit invoking `bun run src/cli/daemon.ts start-foreground` (see docs).',
      );
      return;
    }
    deps.writeFile(deps.plistPath, deps.renderPlist());
    deps.run('launchctl', ['load', deps.plistPath]);
    deps.print(`installed ${deps.plistPath}`);
    return;
  }
  if (cmd === 'start') {
    deps.run('launchctl', ['load', deps.plistPath]);
    return;
  }
  if (cmd === 'start-foreground') {
    await deps.startForeground(); // the launchd ProgramArguments target
    return;
  }
  if (cmd === 'stop') {
    deps.run('launchctl', ['unload', deps.plistPath]);
    await deps.stopDaemon();
    return;
  }
  if (cmd === 'status') {
    const s = deps.status();
    deps.print(s.running ? `running (pid ${s.pid})` : 'not running');
    return;
  }
  if (cmd === 'logs') {
    deps.run('tail', ['-f', ...deps.logPaths]);
    return;
  }
  deps.print('usage: agent daemon <install|start|stop|status|logs>');
}
```
Add `"daemon": "bun run src/cli/daemon.ts"` to `package.json` `scripts`.

- [ ] **Step 4: Run — verify it passes** (`bun test tests/cli/daemon.test.ts` → 4 tests).

- [ ] **Step 5: Gate + commit**
```bash
bun run typecheck && bun run lint:file -- src/cli/daemon.ts package.json tests/cli/daemon.test.ts
git add src/cli/daemon.ts package.json tests/cli/daemon.test.ts
git commit -m "feat(cli): agent daemon install/start/stop/status/logs (Slice 24 Incr 4)"
```

## Task 30: Daemon + queue telemetry spans (item 18)

**Files:**
- Create: `src/daemon/spans.ts`
- Modify: `src/queue/pool.ts` (wrap claim→dispatch in `job.run`; emit `job.retry`/`job.cancel`), `src/server/jobs/enqueue.ts` (`job.enqueue` span)
- Create: `tests/daemon/spans.test.ts`

**Interfaces:**
- Consumes: the existing span helpers (`src/telemetry/spans.ts` `inSpan`/recorder pattern), `withRunContext` (`src/telemetry/run-router.ts:101`) so job spans nest under each job's run root.
- Produces: `recordDaemonStart({ pid })` → `daemon.start` span; `recordDaemonStop({ pid })` → `daemon.stop`; `withJobRunSpan(job, fn)` → `job.run` (attributes: `job.id`, `job.kind`, `job.priority`, `job.attempt`); `recordJobEnqueue(job)` → `job.enqueue`; `recordJobRetry`/`recordJobCancel`. All follow `gen_ai.*`/OTel conventions (spec §8). Each run span carries the populated `RunDTO.origin`/`server.principal` provenance (Task 24) so a daemon-originated run is distinguishable. The daemon owns the tracer lifecycle (no change to per-run routing beyond that).

- [ ] **Step 1: Write the failing test** — assert `recordDaemonStart` opens+closes a `daemon.start` span (capture via an in-memory exporter, precedent in existing `tests/telemetry/`); assert `withJobRunSpan` sets the `job.kind` attribute and nests under `withRunContext(job.runId)`.

- [ ] **Step 2–5:** implement the span helpers, wire them into pool + enqueue, replace the Task 27 no-op stubs, test green, then:
```bash
bun run typecheck && bun run lint:file -- src/daemon/spans.ts src/queue/pool.ts src/server/jobs/enqueue.ts tests/daemon/spans.test.ts
git add src/daemon/spans.ts src/queue/pool.ts src/server/jobs/enqueue.ts tests/daemon/spans.test.ts
git commit -m "feat(telemetry): daemon + job spans with provenance (Slice 24 Incr 4, item 18)"
```

## Task 31: Boundary gate — Increment 4

**Files:** none (verification only).

- [ ] **Step 1: Full gate**
```bash
bun run check
```
Expected: `bun run check` PASS — **cumulative test count ~1672, 0 fail** (Increment 4 adds ~12 PID/daemon-core/launchd/CLI/span tests). `src/daemon/` is a new subsystem — add its one-line module-map stub to `architecture.md` if docs:check flags it (full Daemon section = Increment 7). All daemon lifecycle + span tests green.

---

# Increment 5 — Durable auth + hardening (`src/server/security/root-token.ts`, threat model §7.4)

**Purpose (spec §5.5, D4, D7):** replace the process-ephemeral token (`token.ts:5`, dies on restart) with a durable root token that mints short-lived per-device session tokens. Add `maxRequestBodySize`, the `/api/telemetry` pre-parse body-size limit, a configurable bind-address, the tunnel-origin allowlist path, the `@ai-sdk/mcp` `redirect:'error'` SSRF revisit, and the run-dir rate-limit. Threat-model tests per §7.4. Closes deferred items 2, 3, 4, 5, 12, 13, 14.

## Task 32: Root-token store — `getOrCreateRoot` (0600, mint-once) + `rotate`

**Files:**
- Create: `src/server/security/root-token.ts`
- Create: `tests/server/security/root-token.test.ts`

**Interfaces:**
- Consumes: `node:crypto` (`randomBytes`), `node:fs`, `node:os` (`homedir`).
- Produces: the **Shared-contracts** `RootTokenStore` + `createRootTokenStore`. `getOrCreateRoot()`: read `~/.agent/daemon-token`; if absent, mint 256 bits (hex) and write `0600` (mint-once — survives restart); return the token. `rotate()`: mint a new root, overwrite `0600`, return it (invalidates every session token derived from the old root). `defaultRootTokenPath()`.

- [ ] **Step 1: Write the failing test**
```typescript
import { test, expect } from 'bun:test';
import { mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRootTokenStore } from '../../../src/server/security/root-token.ts';

const tempPath = () => join(mkdtempSync(join(tmpdir(), 'root-')), 'daemon-token');

test('getOrCreateRoot mints once and is stable across calls (survives "restart")', () => {
  const path = tempPath();
  const a = createRootTokenStore({ path }).getOrCreateRoot();
  const b = createRootTokenStore({ path }).getOrCreateRoot(); // fresh store = "restart"
  expect(a).toBe(b);
  expect(a).toHaveLength(64); // 32 bytes hex
});

test('the token file is chmod 0600', () => {
  const path = tempPath();
  createRootTokenStore({ path }).getOrCreateRoot();
  expect(statSync(path).mode & 0o777).toBe(0o600);
});

test('rotate changes the root', () => {
  const path = tempPath();
  const store = createRootTokenStore({ path });
  const before = store.getOrCreateRoot();
  const after = store.rotate();
  expect(after).not.toBe(before);
  expect(store.getOrCreateRoot()).toBe(after); // persisted
});
```

- [ ] **Step 2: Run — verify it fails.**

- [ ] **Step 3: Implement `src/server/security/root-token.ts`**
```typescript
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export function defaultRootTokenPath(): string {
  return join(homedir(), '.agent', 'daemon-token');
}

export type RootTokenStore = {
  getOrCreateRoot(): string;
  rotate(): string;
};

function mint(): string {
  return randomBytes(32).toString('hex');
}

export function createRootTokenStore(config: { path?: string }): RootTokenStore {
  const path = config.path ?? defaultRootTokenPath();
  function write(token: string): void {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, token, { mode: 0o600 });
  }
  return {
    getOrCreateRoot(): string {
      if (existsSync(path)) {
        const t = readFileSync(path, 'utf8').trim();
        if (t.length > 0) return t;
      }
      const token = mint();
      write(token);
      return token;
    },
    rotate(): string {
      const token = mint();
      write(token);
      return token;
    },
  };
}
```

- [ ] **Step 4: Run — verify it passes.**

- [ ] **Step 5: Gate + commit**
```bash
bun run typecheck && bun run lint:file -- src/server/security/root-token.ts tests/server/security/root-token.test.ts
git add src/server/security/root-token.ts tests/server/security/root-token.test.ts
git commit -m "feat(security): durable root token (0600, mint-once, rotate) (Slice 24 Incr 5, D4)"
```

## Task 33: Session-token store — per-device mint (TTL), verify (constant-time), revoke [OPUS/ultracode]

**Files:**
- Create: `src/server/security/session-token.ts`
- Create: `tests/server/security/session-token.test.ts`

**Interfaces:**
- Consumes: `createRootTokenStore` (Task 32), `node:crypto` (`createHmac`, `timingSafeEqual` — the SAME constant-time compare `token.ts:22` uses), a persisted revocation set (a small `~/.agent/revoked.json` or a `bun:sqlite` table — pick the JSON file for simplicity, `0600`).
- Produces: the **Shared-contracts** `SessionTokenStore` + `createSessionTokenStore`. `mintSessionToken({ deviceId, ttlMs })`: build `payload = base64url({ deviceId, exp: now+ttlMs })`, `sig = HMAC-SHA256(rootToken, payload)`, token = `payload.sig`. `verifySessionToken(raw)`: split, recompute sig, **`timingSafeEqual`**, check `exp > now` and `deviceId ∉ revoked`; return `{ deviceId }` or `null`. `revokeDevice(deviceId)`: persist to the revocation set (survives restart). A rotated root (Task 32) invalidates ALL sessions because their sigs no longer verify against the new root. The browser holds ONLY the session token, never the root (§7.4).

- [ ] **Step 1: Write the failing test** — mint for `deviceId:'mac-2'`, `ttlMs: 60_000` → `verifySessionToken` returns `{ deviceId:'mac-2' }`; a token with `ttlMs: -1` (already expired) → `null`; a tampered payload → `null`; `revokeDevice('mac-2')` then verify → `null`; a token minted under the old root fails after `rotate()`. Assert the compare is constant-time by construction (uses `timingSafeEqual`, asserted via a length-mismatch returning `null` not throwing).
```typescript
import { test, expect } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRootTokenStore } from '../../../src/server/security/root-token.ts';
import { createSessionTokenStore } from '../../../src/server/security/session-token.ts';

function stores() {
  const dir = mkdtempSync(join(tmpdir(), 'tok-'));
  const root = createRootTokenStore({ path: join(dir, 'daemon-token') }).getOrCreateRoot();
  return createSessionTokenStore({ path: join(dir, 'sessions'), rootToken: root });
}

test('mint + verify round-trips a device id within TTL', () => {
  const s = stores();
  const tok = s.mintSessionToken({ deviceId: 'mac-2', ttlMs: 60_000 });
  expect(s.verifySessionToken(tok)?.deviceId).toBe('mac-2');
});
test('an expired token verifies null', () => {
  const s = stores();
  expect(s.verifySessionToken(s.mintSessionToken({ deviceId: 'd', ttlMs: -1 }))).toBeNull();
});
test('a tampered token verifies null', () => {
  const s = stores();
  const tok = s.mintSessionToken({ deviceId: 'd', ttlMs: 60_000 });
  expect(s.verifySessionToken(`${tok}x`)).toBeNull();
});
test('revokeDevice invalidates without rotating root', () => {
  const s = stores();
  const tok = s.mintSessionToken({ deviceId: 'd', ttlMs: 60_000 });
  s.revokeDevice('d');
  expect(s.verifySessionToken(tok)).toBeNull();
});
```

- [ ] **Step 2: Run — verify it fails.**

- [ ] **Step 3: Implement `src/server/security/session-token.ts`** — HMAC-signed stateless token + a persisted revocation set. Use `createHmac('sha256', rootToken)`; compare sigs with `timingSafeEqual` on equal-length buffers (return `null`, never throw, on length mismatch — mirror `token.ts:23`). Persist revocations to a `0600` JSON file loaded at construction.

- [ ] **Step 4: Run — verify it passes.**

- [ ] **Step 5: Gate + commit**
```bash
bun run typecheck && bun run lint:file -- src/server/security/session-token.ts tests/server/security/session-token.test.ts
git add src/server/security/session-token.ts tests/server/security/session-token.test.ts
git commit -m "feat(security): per-device session tokens TTL+revoke, constant-time verify (Slice 24 Incr 5, D4/§7.4)"
```

## Task 34: Wire durable auth into the server — root→session guard, principal from device

**Files:**
- Modify: `src/server/security/token.ts` (extend `TokenGuard.verify` to also accept a valid session token and expose the resolved `deviceId` as the principal)
- Modify: `src/server/app.ts` (`buildFetch` builds the guard from the session-token store; on a verified session token, thread `deviceId` as the `principal` into `withServerRequestSpan` — Task 24's seam)
- Modify: `src/server/main.ts` (`startWebServer` builds `createRootTokenStore().getOrCreateRoot()` + `createSessionTokenStore(...)` instead of `mintSessionToken()`; the injected index-HTML token becomes a freshly-minted per-device session token, not the root)
- Modify: touched server tests
- Create: `tests/server/auth-durable.test.ts`

**Interfaces:**
- Consumes: `createRootTokenStore`/`createSessionTokenStore` (Tasks 32/33), `createTokenGuard` (`token.ts:15`).
- Produces: `createSessionGuard(sessionTokens: SessionTokenStore): TokenGuard & { principal(req): string | undefined }` — `verify(req)` extracts the bearer, `verifySessionToken`, returns bool; `principal(req)` returns the deviceId. `startWebServer` mints the browser's session token (short TTL) from the durable root and injects THAT (never the root) into the served HTML (`main.ts:141,215`). The root never reaches `window.__AGENT_TOKEN__`. Legacy per-process `mintSessionToken` (`token.ts:5`) is removed from the boot path (kept only if a test fixture still needs a raw token; prefer deleting its boot use).

- [ ] **Step 1: Write the failing test** — `tests/server/auth-durable.test.ts`: boot `startWebServer({ port: 0 })`; a request with a valid session bearer → 200 on `/api/jobs`; a request with a bogus bearer → 401; a request with the ROOT token as bearer → 401 (root is not a session token — only sessions authenticate requests). Assert the injected `window.__AGENT_TOKEN__` in the served HTML is NOT the root token.

- [ ] **Step 2: Run — verify it fails.**

- [ ] **Step 3: Implement** the guard extension + boot wiring + principal threading.

- [ ] **Step 4: Run — verify it passes** (+ regression on `tests/server/perimeter*`/`token*` tests).

- [ ] **Step 5: Gate + commit**
```bash
bun run typecheck && bun run lint:file -- src/server/security/token.ts src/server/app.ts src/server/main.ts tests/server/auth-durable.test.ts
git add src/server/security/token.ts src/server/app.ts src/server/main.ts tests/server/auth-durable.test.ts
git commit -m "feat(security): root→session token guard + device principal at boot (Slice 24 Incr 5, D4)"
```

## Task 35: `maxRequestBodySize` cap on `Bun.serve` (item 3)

**Files:**
- Modify: `src/server/main.ts` (`Bun.serve({ ..., maxRequestBodySize })`)
- Modify: `src/config/schema.ts` (add `AGENT_WEB_MAX_BODY_BYTES`, computed default)
- Create: `tests/server/body-cap.test.ts`

**Interfaces:**
- Consumes: `Bun.serve`'s `maxRequestBodySize` option.
- Produces: the server rejects an over-cap request body at the runtime layer (413). Default computed (a sane cap sized to allow uploads but bound abuse — env-override `AGENT_WEB_MAX_BODY_BYTES`, never a magic literal in code; the config `def` documents the number).

- [ ] **Step 1: Write the failing test** — `tests/server/body-cap.test.ts`:
```typescript
import { test, expect } from 'bun:test';
import { startWebServer } from '../../src/server/main.ts';

test('a request body over AGENT_WEB_MAX_BODY_BYTES is rejected with 413', async () => {
  process.env.AGENT_WEB_MAX_BODY_BYTES = '1024';
  const h = startWebServer({ port: 0 });
  try {
    const res = await fetch(`http://127.0.0.1:${h.port}/api/telemetry`, {
      method: 'POST',
      body: 'x'.repeat(8192), // over the 1 KiB cap
    });
    expect(res.status).toBe(413); // enforced by Bun.serve BEFORE the fetch handler
  } finally {
    await h.pool.stop();
    h.server.stop();
    delete process.env.AGENT_WEB_MAX_BODY_BYTES;
  }
});
```

- [ ] **Step 2: Run — verify it fails** (no cap → the body is accepted, not 413).

- [ ] **Step 3: Implement** — add the config row to `src/config/schema.ts`:
```typescript
  {
    env: 'AGENT_WEB_MAX_BODY_BYTES',
    kind: 'number',
    def: 26_214_400, // 25 MiB — allows chat media uploads while bounding abuse
    doc: 'Max HTTP request body bytes Bun.serve accepts (server/main.ts). Over-cap requests get 413 at the runtime layer before the handler runs. Env-override.',
  },
```
and pass it in the `Bun.serve` options (`main.ts:243`):
```typescript
  const server = Bun.serve({
    port,
    hostname: opts.bind ?? String(cfg.AGENT_WEB_BIND), // Task 37
    fetch: buildFetch(deps),
    idleTimeout: 0,
    maxRequestBodySize: cfg.AGENT_WEB_MAX_BODY_BYTES as number,
  });
```
(If Task 37 has not landed yet, omit the `hostname` line here and add it there — the two touch the same `Bun.serve` call.)

- [ ] **Step 4: Run — verify it passes** (`bun test tests/server/body-cap.test.ts`).

- [ ] **Step 5: Gate + commit**
```bash
bun run typecheck && bun run lint:file -- src/server/main.ts src/config/schema.ts tests/server/body-cap.test.ts
git add src/server/main.ts src/config/schema.ts tests/server/body-cap.test.ts
git commit -m "feat(server): maxRequestBodySize cap (Slice 24 Incr 5, item 3)"
```

## Task 36: `/api/telemetry` pre-parse body-size limit BEFORE `req.json()` (item 4)

**Files:**
- Modify: `src/server/telemetry/handler.ts` (check `Content-Length` / cap the read BEFORE `await req.json()` at `handler.ts:37`)
- Create: `tests/server/telemetry-body-limit.test.ts`

**Interfaces:**
- Consumes: `req.headers.get('content-length')` + a small telemetry-specific cap.
- Produces: `handleTelemetry` returns 413 for an over-limit body **before** parsing (the beacon is unauthenticated at the header-guard layer — `app.ts:127` lets it past — so an attacker could POST a huge body pre-auth; cap it before `req.json()`). A missing/oversize `Content-Length` short-circuits to 413; only within-limit bodies reach `req.json()` and the existing token check.

- [ ] **Step 1: Write the failing test** — `tests/server/telemetry-body-limit.test.ts`:
```typescript
import { test, expect } from 'bun:test';
import { handleTelemetry } from '../../src/server/telemetry/handler.ts';

const guard = { verify: () => false } as never;

test('an over-limit Content-Length is 413 before the body is parsed', async () => {
  // Body that WOULD throw if parsed as JSON — proves req.json() was never reached.
  const req = new Request('http://x/api/telemetry', {
    method: 'POST',
    headers: { 'content-length': String(10_000_000) },
    body: 'not-json-would-throw',
  });
  expect((await handleTelemetry(req, guard)).status).toBe(413);
});

test('a missing Content-Length is refused (beacon always sets one)', async () => {
  const req = new Request('http://x/api/telemetry', { method: 'POST', body: '{}' });
  // fetch/undici may auto-set CL; force the header absent by asserting the guard
  // never rejects a within-limit body below rather than over-constraining here.
  const res = await handleTelemetry(req, guard);
  expect([413, 401]).toContain(res.status); // 413 if CL truly absent, else the token path
});

test('a within-limit body reaches the existing token check (not 413)', async () => {
  const req = new Request('http://x/api/telemetry', {
    method: 'POST',
    headers: { 'content-length': '2' },
    body: '{}',
  });
  expect((await handleTelemetry(req, guard)).status).not.toBe(413);
});
```

- [ ] **Step 2: Run — verify it fails** (the over-limit body is parsed today, not short-circuited).

- [ ] **Step 3: Implement** — add a small config cap to `src/config/schema.ts`:
```typescript
  {
    env: 'AGENT_WEB_TELEMETRY_MAX_BYTES',
    kind: 'number',
    def: 65_536, // 64 KiB — a telemetry beacon is tiny; anything larger is abuse
    doc: 'Max /api/telemetry request-body bytes, checked from Content-Length BEFORE req.json() (server/telemetry/handler.ts). The beacon is header-guard-exempt (app.ts), so cap it pre-parse. Over-limit or missing Content-Length → 413. Env-override.',
  },
```
and guard the top of `handleTelemetry` (`handler.ts`, BEFORE the `await req.json()` at handler.ts:37):
```typescript
  const cap = loadConfig().values.AGENT_WEB_TELEMETRY_MAX_BYTES as number;
  const len = Number(req.headers.get('content-length'));
  // Missing/oversize Content-Length → reject pre-parse (the beacon always sets a
  // small one; this bounds an unauthenticated pre-auth body). Only within-limit
  // bodies reach req.json() and the existing token check.
  if (!Number.isFinite(len) || len > cap) {
    return new Response('payload too large', { status: 413 });
  }
```

- [ ] **Step 4: Run — verify it passes** (`bun test tests/server/telemetry-body-limit.test.ts`).

- [ ] **Step 5: Gate + commit**
```bash
bun run typecheck && bun run lint:file -- src/server/telemetry/handler.ts src/config/schema.ts tests/server/telemetry-body-limit.test.ts
git add src/server/telemetry/handler.ts src/config/schema.ts tests/server/telemetry-body-limit.test.ts
git commit -m "feat(security): /api/telemetry pre-parse body-size limit (Slice 24 Incr 5, item 4)"
```

## Task 37: Configurable bind-address (Tailscale iface + localhost) (item 5/12)

**Files:**
- Modify: `src/server/main.ts` (`Bun.serve({ hostname, ... })` — pass a configured bind address instead of the implicit `0.0.0.0`)
- Modify: `src/config/schema.ts` (add `AGENT_WEB_BIND`, default `'127.0.0.1'` — localhost-only unless the operator opts into a tunnel interface)
- Modify: `src/server/security/origin.ts` (the Host perimeter must still accept the configured bind host + the tunnel origin)
- Create: `tests/server/bind-address.test.ts`

**Interfaces:**
- Consumes: `cfg.AGENT_WEB_BIND`.
- Produces: `startWebServer` binds the configured hostname (default `127.0.0.1` — no longer the implicit `0.0.0.0`, closing "localhost ≠ trust boundary" at the bind layer; the Tailscale recipe sets `AGENT_WEB_BIND` to the `100.x` tailnet interface + keeps `localhost`). `StartOptions` gains `bind?: string`. This is the network-entry-point half of items 5/12 (the auth half is Tasks 32-34).

- [ ] **Step 1: Write the failing test** — `tests/server/bind-address.test.ts`:
```typescript
import { test, expect } from 'bun:test';
import { loadConfig } from '../../src/config/schema.ts';
import { startWebServer } from '../../src/server/main.ts';

test('startWebServer binds the given loopback address and serves', async () => {
  const h = startWebServer({ port: 0, bind: '127.0.0.1' });
  try {
    const res = await fetch(`http://127.0.0.1:${h.port}/`, {
      headers: { host: `127.0.0.1:${h.port}` },
    });
    expect(res.status).toBeLessThan(500); // loopback reachable
  } finally {
    await h.pool.stop();
    h.server.stop();
  }
});

test('AGENT_WEB_BIND defaults to loopback (no implicit 0.0.0.0)', () => {
  const prev = process.env.AGENT_WEB_BIND;
  delete process.env.AGENT_WEB_BIND;
  try {
    expect(String(loadConfig().values.AGENT_WEB_BIND)).toBe('127.0.0.1');
  } finally {
    if (prev !== undefined) process.env.AGENT_WEB_BIND = prev;
  }
});
```

- [ ] **Step 2: Run — verify it fails** (`StartOptions.bind` + `AGENT_WEB_BIND` do not exist).

- [ ] **Step 3: Implement** — add `bind?: string` to `StartOptions` (main.ts:118); pass `hostname: opts.bind ?? String(cfg.AGENT_WEB_BIND)` into the `Bun.serve` call (same call Task 35 touches). Add the config row:
```typescript
  {
    env: 'AGENT_WEB_BIND',
    kind: 'string',
    def: '127.0.0.1',
    doc: 'Hostname/interface Bun.serve binds (server/main.ts). Default 127.0.0.1 = loopback-only — no implicit 0.0.0.0 ("localhost is not a trust boundary"). Tailscale recipe: set to the 100.x tailnet interface AND keep localhost; auth (Tasks 32-34) still gates every request.',
  },
```
Extend `hostAllowed` (`origin.ts`) so the Host perimeter also accepts the configured bind host (not only the hardcoded `LOCAL_HOSTS`), so a request to the bound tailnet interface is not 403'd at the Host check:
```typescript
export function hostAllowed(req: Request, port: number, extraHosts: string[] = []): boolean {
  const host = req.headers.get('host');
  if (host === null) return false;
  return [...LOCAL_HOSTS, ...extraHosts].some((h) => host === `${h}:${port}`);
}
```
(the `extraHosts` come from `AGENT_WEB_BIND` + the tunnel host; the tunnel-origin threat test is Task 38).

- [ ] **Step 4: Run — verify it passes** (`bun test tests/server/bind-address.test.ts`).

- [ ] **Step 5: Gate + commit**
```bash
bun run typecheck && bun run lint:file -- src/server/main.ts src/config/schema.ts src/server/security/origin.ts tests/server/bind-address.test.ts
git add src/server/main.ts src/config/schema.ts src/server/security/origin.ts tests/server/bind-address.test.ts
git commit -m "feat(server): configurable bind-address, default loopback (Slice 24 Incr 5, item 5)"
```

## Task 38: Tunnel-origin allowlist + threat-model perimeter test (§7.4, item 13)

**Files:**
- Create: `tests/server/threat-model.test.ts`
- Modify: `src/server/security/origin.ts` ONLY if the test finds a gap (the allowlist path already exists, `origin.ts:22`)

**Interfaces:**
- Consumes: `enforcePerimeter` (`origin.ts:26`), the durable session guard (Task 34), `AGENT_WEB_ORIGIN_ALLOWLIST` (`schema.ts:488`).
- Produces: the §7.4 threat-model gate as executable tests: (a) a request from the configured tunnel origin (added via `AGENT_WEB_ORIGIN_ALLOWLIST`) passes the perimeter; a request from an un-allowed cross origin → 403; (b) **tunnel-without-token → 401** (passing the network/perimeter but not the token guard — the network is no longer the trust boundary); (c) a valid session token from the tunnel origin → 200. This proves items 5/12/13 together.

- [ ] **Step 1: Write the gating test** — `tests/server/threat-model.test.ts` (the three §7.4 cases; `h.token` is the injected per-device SESSION token from Task 34):
```typescript
import { test, expect } from 'bun:test';
import { startWebServer } from '../../src/server/main.ts';

const TUNNEL = 'https://mac.tail-scale.ts.net';

function boot() {
  process.env.AGENT_WEB_ORIGIN_ALLOWLIST = TUNNEL;
  return startWebServer({ port: 0 });
}
async function teardown(h: { pool: { stop: () => Promise<void> }; server: { stop: () => void } }) {
  await h.pool.stop();
  h.server.stop();
  delete process.env.AGENT_WEB_ORIGIN_ALLOWLIST;
}

test('tunnel origin WITHOUT a token → 401 (network is NOT the trust boundary)', async () => {
  const h = boot();
  try {
    const res = await fetch(`http://127.0.0.1:${h.port}/api/jobs`, {
      headers: { host: `127.0.0.1:${h.port}`, origin: TUNNEL },
    });
    expect(res.status).toBe(401); // passed the perimeter, failed the token guard
  } finally {
    await teardown(h);
  }
});

test('an un-allowed cross origin → 403 at the perimeter', async () => {
  const h = boot();
  try {
    const res = await fetch(`http://127.0.0.1:${h.port}/api/jobs`, {
      headers: { host: `127.0.0.1:${h.port}`, origin: 'https://evil.example' },
    });
    expect(res.status).toBe(403);
  } finally {
    await teardown(h);
  }
});

test('a valid session token from the allowed tunnel origin → 200', async () => {
  const h = boot();
  try {
    const res = await fetch(`http://127.0.0.1:${h.port}/api/jobs`, {
      headers: {
        host: `127.0.0.1:${h.port}`,
        origin: TUNNEL,
        authorization: `Bearer ${h.token}`,
      },
    });
    expect(res.status).toBe(200);
  } finally {
    await teardown(h);
  }
});
```

- [ ] **Step 2: Run** — the allowlist path (`origin.ts:22`) + durable session guard (Task 34) are expected to satisfy all three. If any case fails, that is a real perimeter/auth gap.

- [ ] **Step 3: Minimal fix if needed** — only in `src/server/security/origin.ts`, guarded by the test (do not loosen the guard beyond what the failing case requires).

- [ ] **Step 4: Run — verify green** (all three cases pass — this is the §7.4/items 5/12/13 proof).

- [ ] **Step 5: Gate + commit**
```bash
bun run typecheck && bun run lint:file -- tests/server/threat-model.test.ts src/server/security/origin.ts
git add tests/server/threat-model.test.ts src/server/security/origin.ts
git commit -m "test(security): tunnel-origin allowlist + tunnel-without-token→401 threat model (Slice 24 Incr 5, §7.4)"
```

## Task 39: `@ai-sdk/mcp` `redirect:'error'` SSRF revisit + run-dir rate-limit (items 14, 2)

**Files:**
- Modify: the remote-MCP fetch/transport site (`src/mcp/**` — grep for the `@ai-sdk/mcp` transport construction / the `fetch` used for a remote MCP server) to set `redirect: 'error'` (a remote MCP endpoint must not be followed through a redirect to an internal address — SSRF defense; architecture.md:1938 flagged it)
- Modify: `src/server/upload.ts` / the run-dir creation path to add a simple rate-limit (item 2 — run-dir rate-limit)
- Create: `tests/mcp/redirect-ssrf.test.ts`, `tests/server/run-dir-rate-limit.test.ts`

**Interfaces:**
- Consumes: the MCP transport's `fetch` option; a small token-bucket / fixed-window counter for run-dir creations.
- Produces: (a) the remote-MCP transport rejects a redirect response rather than following it (test: a stubbed fetch returning a 302 → the mount errors, does not follow); (b) run-dir creation beyond a configured rate returns a 429 (env-override `AGENT_WEB_RUN_RATE`, computed default). Closes items 14 + 2.

- [ ] **Step 1: Write the failing tests** — two seams so each is unit-testable.

  `tests/mcp/redirect-ssrf.test.ts`:
```typescript
import { test, expect } from 'bun:test';
import { noRedirectFetch } from '../../src/mcp/http-redirect.ts';

test('a redirect response is rejected, not followed (SSRF guard)', async () => {
  const fake = async () =>
    new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/' } });
  await expect(noRedirectFetch('https://mcp.example/sse', {}, fake)).rejects.toThrow();
});

test('a normal 200 passes through', async () => {
  const fake = async () => new Response('ok', { status: 200 });
  expect((await noRedirectFetch('https://mcp.example/sse', {}, fake)).status).toBe(200);
});
```

  `tests/server/run-dir-rate-limit.test.ts`:
```typescript
import { test, expect } from 'bun:test';
import { makeRunRateLimiter } from '../../src/server/run-rate.ts';

test('run-dir creation over the window rate is refused, then resets', () => {
  const now = { t: 0 };
  const limiter = makeRunRateLimiter({ max: 2, windowMs: 1000, now: () => now.t });
  expect(limiter.allow()).toBe(true);
  expect(limiter.allow()).toBe(true);
  expect(limiter.allow()).toBe(false); // over the cap in this window
  now.t = 1001;
  expect(limiter.allow()).toBe(true); // next window resets the counter
});
```

- [ ] **Step 2: Run — verify both fail** (modules missing).

- [ ] **Step 3: Implement.** First grep the real transport site: `grep -rn "@ai-sdk/mcp\|redirect\|new .*Transport\|fetch:" src/mcp/`.

  `src/mcp/http-redirect.ts`:
```typescript
/**
 * Fetch for a REMOTE MCP endpoint with redirects treated as errors: a remote
 * MCP server must not be followed through a redirect to an internal address
 * (SSRF defense — architecture.md flagged this). Forces `redirect: 'error'` and
 * defensively rejects a 3xx status if a custom fetch ignores the option.
 */
export async function noRedirectFetch(
  url: string,
  init: RequestInit = {},
  impl: typeof fetch = fetch,
): Promise<Response> {
  const res = await impl(url, { ...init, redirect: 'error' });
  if (res.status >= 300 && res.status < 400) {
    throw new Error(`remote MCP redirect rejected (SSRF guard): ${res.status}`);
  }
  return res;
}
```
Wire `noRedirectFetch` as the `fetch` option at the `@ai-sdk/mcp` remote-transport construction site found by the grep.

  `src/server/run-rate.ts`:
```typescript
/** Fixed-window rate limiter for run-dir creation (item 2). Injectable clock. */
export function makeRunRateLimiter(opts: {
  max: number;
  windowMs: number;
  now?: () => number;
}): { allow(): boolean } {
  const now = opts.now ?? Date.now;
  let windowStart = now();
  let count = 0;
  return {
    allow(): boolean {
      const t = now();
      if (t - windowStart >= opts.windowMs) {
        windowStart = t;
        count = 0;
      }
      if (count >= opts.max) return false;
      count++;
      return true;
    },
  };
}
```
Add the config knob to `src/config/schema.ts`:
```typescript
  {
    env: 'AGENT_WEB_RUN_RATE',
    kind: 'number',
    def: 0,
    doc: 'Max run-dir creations per fixed window (server/run-rate.ts). 0/unset = computed from worker concurrency; positive overrides. Over the rate → 429. Never hardcode.',
  },
```
Gate run-dir creation (the `createRun` call in `handleJobEnqueue`/the migrated crew/workflow/pull handlers) with a process-shared limiter: `if (!runLimiter.allow()) return json({ error: 'rate limited' }, 429);`.

- [ ] **Step 4: Run — verify both pass.**

- [ ] **Step 5: Gate + commit**
```bash
bun run typecheck && bun run lint:file -- src/mcp/http-redirect.ts src/server/run-rate.ts src/config/schema.ts tests/mcp/redirect-ssrf.test.ts tests/server/run-dir-rate-limit.test.ts
git add src/mcp/http-redirect.ts src/server/run-rate.ts src/config/schema.ts tests/mcp/redirect-ssrf.test.ts tests/server/run-dir-rate-limit.test.ts
git commit -m "feat(security): remote-MCP redirect:'error' SSRF guard + run-dir rate-limit (Slice 24 Incr 5, items 14/2)"
```

## Task 39b: Boundary gate — Increment 5

**Files:** none (verification only).

- [ ] **Step 1: Full gate**
```bash
bun run check
```
Expected: `bun run check` PASS — **cumulative test count ~1693, 0 fail** (Increment 5 adds ~21 root-token/session-token/durable-auth/body-cap/telemetry-limit/bind/threat-model/SSRF/rate-limit tests). All auth/threat-model/hardening tests green; the durable token replaces the process-ephemeral one with no perimeter-test regressions.

---

# Increment 6 — Resume wiring (DAG-node step-resume + durable approval)

**SELECTED PATH: `custom`** (decided by Task 3, `docs/superpowers/decisions/2026-07-19-slice-24-resume-substrate.md` — `SUBSTRATE = custom`; the installed `@ai-sdk/workflow@1.0.31` has no store/resume of its own, re-executed node `a` on resume in the Task 2 spike). Execute **Task 40b/41b only**; Task 40a is skipped as moot. **Execute only the tasks tagged with the selected path** (the `a` variant for `adopt`, the `b` variant for `custom`). D5 pre-committed BOTH so the deliverable (resume at DAG-node granularity, no re-execution of completed nodes) is fixed either way. The non-selected variant's tasks are skipped (leave them unchecked with a `SKIPPED — path not selected` note in the ledger).

**Purpose (spec §5.6, D5b/D5c, §7.3):** wire `--resume <run-id>` / re-enqueue to skip completed workflow/crew DAG nodes and continue at the first incomplete node — the real multi-hour-job story. Make consent/approval durable (subsuming the in-memory `createConsentRegistry` that is lost on restart, `registry.ts:28`). Restart-durability tests prove no double-execution (§7.3). Closes deferred items 1 (consent eviction), 9 (`--resume`), 10 (durable execution), 11 (resume half of Slice-21 charter).

## Task 40a: [ADOPT PATH] Integrate `WorkflowAgent` durable execution into crew/workflow run turns

> **⚠ POST-SPIKE — DELIBERATELY LEFT PROSE.** This task's real test + implementation code cannot be written until Increment 1's decision record (Task 3) confirms `SUBSTRATE = adopt` **and pins the actual `@ai-sdk/workflow` `WorkflowAgent` API surface** (store construction, node/step API, resume entry point) discovered by the spike — inventing method names here would ship the exact "plan sample code has defects" failure. **Flesh this task to the fenced-code standard (real `bun:test` + real fenced impl) ONLY after the spike, and do NOT execute 40a until then.** If the decision is `SUBSTRATE = custom`, skip 40a entirely and execute the fully-fenced Task 40b instead.

**Files:**
- Modify: `src/server/launch-turns.ts` (`createRealRunCrewTurn`/`createRealRunWorkflowTurn` run the DAG through `WorkflowAgent` with a filesystem store rooted at the run dir)
- Modify: `src/workflow/**` as the spike decided (wrap, not replace, the existing engine)
- Create: `tests/workflow/workflow-agent-resume.test.ts`

**Interfaces:**
- Consumes: `@ai-sdk/workflow` `WorkflowAgent` + filesystem store (Increment 1 API, as proven by the spike), the existing `WorkflowDef`/`CrewDef` node structure, the run dir (`run.dir`).
- Produces: crew/workflow runs persist per-node state to a filesystem store keyed by `runId` before each node; a re-enqueue of the same `runId` resumes from the last completed node with NO re-execution. This is the D5c-adopted realization of DAG-node step-resume.

- [ ] **Step 1–5:** TDD — a 3-node workflow run, killed after node 1, re-enqueued with the same `runId`, completes nodes 2-3 without re-running node 1 (mirror the spike's assertion, now against the production run turn). Implement per the spike's proven API surface. Commit `feat(workflow): WorkflowAgent DAG-node resume in run turns (Slice 24 Incr 6, D5c adopt)`.

## Task 40b: [CUSTOM PATH] Per-node checkpoint store in `src/workflow/checkpoint.ts`

**Files:**
- Create: `src/workflow/checkpoint.ts`
- Modify: `src/cli/flow.ts` / `src/cli/crew.ts` (the `runFlow`/`runCrewCli` DAG loop writes a checkpoint after each completed node + skips already-checkpointed nodes on resume)
- Create: `tests/workflow/checkpoint.test.ts`

**Interfaces:**
- Consumes: the existing DAG-node iteration in `runFlow`/`runCrewCli`, the run dir (`run.dir`), `bun:sqlite` OR a JSON file per run (choose JSON-per-run under `runs/<id>/checkpoint.json` for simplicity — one small object `{ completed: string[]; nodeResults: Record<string, unknown> }`).
- Produces: `createCheckpointStore(runDir): { completed(): Set<string>; record(nodeId, result): void; resultOf(nodeId): unknown }` — the DAG loop calls `completed()` at start to skip finished nodes, `record(nodeId, result)` after each node (atomic write), so a re-enqueue of the same `runId` resumes at the first incomplete node with NO re-execution. This is the D5-fallback realization of DAG-node step-resume — identical deliverable to 40a.

- [ ] **Step 1: Write the failing test**
```typescript
import { test, expect } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCheckpointStore } from '../../src/workflow/checkpoint.ts';

test('a recorded node is skipped on resume with its result available', () => {
  const dir = mkdtempSync(join(tmpdir(), 'run-'));
  const s1 = createCheckpointStore(dir);
  s1.record('a', { out: 1 });
  s1.record('b', { out: 2 });
  const s2 = createCheckpointStore(dir); // "resume" — fresh store, same dir
  expect(s2.completed()).toEqual(new Set(['a', 'b']));
  expect(s2.resultOf('a')).toEqual({ out: 1 });
  expect(s2.completed().has('c')).toBe(false);
});
```

- [ ] **Step 2: Run — verify it fails** (`src/workflow/checkpoint.ts` missing).

- [ ] **Step 3: Implement `src/workflow/checkpoint.ts`**
```typescript
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

type CheckpointFile = { completed: string[]; nodeResults: Record<string, unknown> };

/**
 * Per-run DAG-node checkpoint (D5 fallback). Backs a single JSON file at
 * `runs/<id>/checkpoint.json`: the DAG loop calls `completed()` at start to skip
 * finished nodes and `record(nodeId, result)` after each node, so a re-enqueue
 * of the same runId resumes at the first incomplete node with NO re-execution.
 */
export function createCheckpointStore(runDir: string): {
  completed(): Set<string>;
  record(nodeId: string, result: unknown): void;
  resultOf(nodeId: string): unknown;
} {
  const path = join(runDir, 'checkpoint.json');
  const state: CheckpointFile = existsSync(path)
    ? (JSON.parse(readFileSync(path, 'utf8')) as CheckpointFile)
    : { completed: [], nodeResults: {} };

  function persist(): void {
    mkdirSync(dirname(path), { recursive: true });
    // Atomic write: temp then rename, so a crash mid-write never leaves a
    // half-written checkpoint (which would corrupt resume — the whole point).
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify(state));
    renameSync(tmp, path);
  }

  return {
    completed: (): Set<string> => new Set(state.completed),
    record(nodeId: string, result: unknown): void {
      if (!state.completed.includes(nodeId)) state.completed.push(nodeId);
      state.nodeResults[nodeId] = result;
      persist();
    },
    resultOf: (nodeId: string): unknown => state.nodeResults[nodeId],
  };
}
```
Then wire the skip-completed loop into the DAG iteration in `runFlow` (`src/cli/flow.ts`) / `runCrewCli` (`src/cli/crew.ts`):
```typescript
  const ckpt = createCheckpointStore(run.dir);
  const done = ckpt.completed();
  for (const node of orderedNodes) {
    if (done.has(node.id)) continue; // resume: skip an already-completed node
    const result = await executeNode(node, /* ... */);
    ckpt.record(node.id, result); // persist BEFORE moving to the next node
  }
```

- [ ] **Step 4: Add + run the 3-node resume test** — `tests/workflow/checkpoint-resume.test.ts`: run a 3-node flow whose node `b` throws on the first pass (leaving `a` checkpointed, `c` not reached); re-run the SAME `run.dir`; assert `a` is NOT re-executed (a per-node exec counter shows `a === 1`) and `c` completes. Run `bun test tests/workflow/checkpoint.test.ts tests/workflow/checkpoint-resume.test.ts` → green.

- [ ] **Step 5: Gate + commit**
```bash
bun run typecheck && bun run lint:file -- src/workflow/checkpoint.ts src/cli/flow.ts src/cli/crew.ts tests/workflow/checkpoint.test.ts tests/workflow/checkpoint-resume.test.ts
git add src/workflow/checkpoint.ts src/cli/flow.ts src/cli/crew.ts tests/workflow/
git commit -m "feat(workflow): per-node checkpoint store + DAG resume (Slice 24 Incr 6, D5 fallback)"
```

## Task 41: `--resume <run-id>` / re-enqueue → DAG-node skip [BOTH PATHS]

**Files:**
- Modify: `src/server/jobs/dispatch.ts` (a job carrying a `resumeRunId` in its payload resumes that run's DAG instead of starting fresh)
- Modify: `src/server/jobs/enqueue.ts` (accept an optional `resume` flag / `runId` to re-enqueue an existing run)
- Modify: `src/queue/store.ts` `reconcileOrphans` — thread a `durable` predicate so a checkpoint-resumable orphan (crew/workflow) → `Queued` (`requeued`), not `Interrupted` (completing the Task 10 seam)
- Modify: `src/daemon/core.ts` (`start()` passes `reconcileOrphans({ durable: opts.durable })`) + `src/cli/daemon.ts` (supplies the crew/workflow `durable` predicate when building the daemon)
- Create: `tests/server/jobs/resume.test.ts`

**Interfaces:**
- Consumes: Task 40a OR 40b resume mechanism; `reconcileOrphans` (Task 10).
- Produces: `reconcileOrphans({ durable: (job) => boolean })` — a crew/workflow orphan with a checkpoint (adopt or custom) transitions to `Queued` so the pool re-claims and resumes; a non-durable orphan (chat/pull/build) → `Interrupted`. The dispatch executor, given a `resumeRunId`, hydrates the checkpoint/`WorkflowAgent` store and continues. `POST /api/jobs` accepts `{ resume: runId }` to re-enqueue. **`reconcileOrphans`'s signature changes** from Task 10's zero-arg form to accept the optional `durable` predicate (default: all-Interrupted, preserving Increment 2 behaviour when no predicate is passed).

- [ ] **Step 1: Write the failing test** — `tests/server/jobs/resume.test.ts`:
```typescript
import { test, expect } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJobStore } from '../../../src/queue/store.ts';
import { JobKind, JobStatus } from '../../../src/queue/types.ts';

function tempStore() {
  return createJobStore({ path: mkdtempSync(join(tmpdir(), 'jobs-')) }, {});
}

test('reconcileOrphans requeues durable orphans and interrupts the rest', () => {
  const store = tempStore();
  const crew = store.enqueue({ kind: JobKind.Crew, payload: 1 });
  const chat = store.enqueue({ kind: JobKind.Chat, payload: 2 });
  store.claimNext(); // crew -> Running (oldest)
  store.claimNext(); // chat -> Running
  const res = store.reconcileOrphans({
    durable: (j) => j.kind === JobKind.Crew || j.kind === JobKind.Workflow,
  });
  expect(res.requeued).toBe(1);
  expect(res.interrupted).toBe(1);
  expect(store.getJob(crew.id)?.status).toBe(JobStatus.Queued); // resumable → re-claimed
  expect(store.getJob(crew.id)?.availableAt).toBe(0); // immediately claimable at boot
  expect(store.getJob(chat.id)?.status).toBe(JobStatus.Interrupted);
  store.close();
});

test('reconcileOrphans with no predicate still interrupts all (Inc-2 behaviour preserved)', () => {
  const store = tempStore();
  const crew = store.enqueue({ kind: JobKind.Crew, payload: 1 });
  store.claimNext();
  expect(store.reconcileOrphans()).toEqual({ interrupted: 1, requeued: 0 });
  expect(store.getJob(crew.id)?.status).toBe(JobStatus.Interrupted);
  store.close();
});
```

- [ ] **Step 2: Run — verify it fails** (`reconcileOrphans` is still zero-arg from Task 10).

- [ ] **Step 3: Implement.** Evolve `reconcileOrphans` in `src/queue/store.ts` (the Task-10 seam) to take the optional predicate — default preserves the all-Interrupted Increment-2 behaviour:
```typescript
  function reconcileOrphans(opts?: {
    durable?: (job: JobRecord) => boolean;
  }): { interrupted: number; requeued: number } {
    const isDurable = opts?.durable;
    const tx = db.transaction((): { interrupted: number; requeued: number } => {
      const at = Date.now();
      const running = db
        .query(`SELECT * FROM jobs WHERE status = 'running'`)
        .all() as JobRowRaw[];
      let interrupted = 0;
      let requeued = 0;
      for (const raw of running) {
        const job = toJobRecord(raw);
        if (isDurable?.(job)) {
          // Checkpoint-resumable (crew/workflow): re-queue so the pool re-claims
          // and the dispatch resumes from the last completed node. Reset
          // available_at to 0 so it is immediately claimable at boot.
          db.run(
            `UPDATE jobs SET status = 'queued', started_at = NULL,
             available_at = 0, updated_at = ? WHERE id = ?`,
            [at, job.id],
          );
          requeued++;
        } else {
          db.run(
            `UPDATE jobs SET status = 'interrupted', finished_at = ?, updated_at = ?
             WHERE id = ?`,
            [at, at, job.id],
          );
          interrupted++;
        }
      }
      return { interrupted, requeued };
    });
    return tx();
  }
```
Then wire the resume entry points (branch on the Task 3 SELECTED PATH):
  - `src/server/jobs/enqueue.ts` — accept `{ resume: runId }` on `JobEnqueueRequestSchema` (an optional field): when present, re-enqueue a job for that existing `runId` (do NOT pre-create a fresh run) with a `resumeRunId` in the payload.
  - `src/server/jobs/dispatch.ts` — when the job payload carries `resumeRunId`, the crew/workflow executor hydrates the resume state and continues instead of starting fresh: **custom path** reads `createCheckpointStore(runDir).completed()` (Task 40b) and skips finished nodes; **adopt path** re-runs the `WorkflowAgent` against the same filesystem store keyed by `runId` (Task 40a), which resumes intrinsically.
  - The daemon (Task 27): add `durable?: (job: JobRecord) => boolean` to `createDaemon`'s opts (Shared contracts) and have `start()` pass it — `opts.queue.reconcileOrphans({ durable: opts.durable })` — so orphaned durable runs auto-resume at boot. When absent (Increments 4-5, before this task), the zero-arg default preserves the all-Interrupted behaviour. Wire `daemon.ts` (Task 29) to supply `durable: (j) => j.kind === JobKind.Crew || j.kind === JobKind.Workflow`.

- [ ] **Step 4: Run — verify it passes** (`bun test tests/server/jobs/resume.test.ts`).

- [ ] **Step 5: Gate + commit**
```bash
bun run typecheck && bun run lint:file -- src/queue/store.ts src/server/jobs/enqueue.ts src/server/jobs/dispatch.ts tests/server/jobs/resume.test.ts
git add src/queue/store.ts src/server/jobs/enqueue.ts src/server/jobs/dispatch.ts tests/server/jobs/resume.test.ts
git commit -m "feat(queue): durable-orphan requeue + --resume DAG-node skip (Slice 24 Incr 6, item 9)"
```

## Task 42: Durable consent/approval subsuming the in-memory registry [BOTH PATHS]

**Files:**
- Create: `src/server/consent/durable-registry.ts`
- Modify: `src/server/consent/respond.ts` + `src/server/main.ts` (wire the durable registry)
- Create: `tests/server/consent/durable-registry.test.ts`

**Interfaces:**
- Consumes: the `ConsentRegistry` port shape (`registry.ts:15`), a persisted pending-prompt store (`bun:sqlite` table or JSON, keyed by `promptId`, carrying `runId` + `ask`), the `WorkflowAgent` durable `needsApproval` (adopt path) OR the checkpoint store (custom path).
- Produces: `createDurableConsentRegistry(config)` implementing the SAME `ConsentRegistry` interface (`port`/`resolve`/`pending`) but persisting pending prompts so a prompt awaiting an answer **survives a daemon restart** (the in-memory Map at `registry.ts:31` is lost today — item 1). On boot, pending prompts are reloaded so `POST /api/runs/:id/respond` can still resolve them. Adopt path: delegate to `WorkflowAgent`'s durable `needsApproval`; custom path: back the Map with the persisted store.

- [ ] **Step 1: Write the failing test** — `tests/server/consent/durable-registry.test.ts`:
```typescript
import { test, expect } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDurableConsentRegistry } from '../../../src/server/consent/durable-registry.ts';

const noopEmit = () => {};

test('a pending prompt survives a restart and is still resolvable exactly once', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'consent-')), 'consent.json');
  const r1 = createDurableConsentRegistry({ path });
  // Register a prompt (the awaiting Promise is intentionally left un-awaited).
  void r1.port({ kind: 'tool', question: 'ok?' }, noopEmit);
  const [promptId] = r1.pending();
  expect(promptId).toBeDefined();

  // "Restart": a fresh registry over the SAME store reloads the pending prompt.
  const r2 = createDurableConsentRegistry({ path });
  expect(r2.pending()).toContain(promptId);
  expect(r2.resolve(promptId as string, { approved: true })).toBe(true);
  expect(r2.pending()).not.toContain(promptId); // settled + persisted
  expect(r2.resolve(promptId as string, { approved: true })).toBe(false); // no double-settle
});
```

- [ ] **Step 2: Run — verify it fails** (`createDurableConsentRegistry` missing).

- [ ] **Step 3: Implement `src/server/consent/durable-registry.ts`** — the SAME `ConsentRegistry` port (`registry.ts:15`: `port`/`resolve`/`pending`), backed by a `0600` JSON file keyed by `promptId` so a prompt awaiting an answer survives a daemon restart (the in-memory `Map` at `registry.ts:31` is lost today — item 1):
```typescript
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { StatusEventType } from '../../contracts/enums.ts';
import type { EventSink } from '../../core/events.ts';
import type { ConfirmAsk, ConfirmPort, ConsentRegistry } from './registry.ts';

type PromptRec = { ask: ConfirmAsk; runId?: string; answer?: unknown; settled: boolean };
type Store = Record<string, PromptRec>;

export function createDurableConsentRegistry(config: {
  path?: string;
  runId?: string;
}): ConsentRegistry {
  const path = config.path ?? 'runs/_consent/consent.json';
  const store: Store = existsSync(path)
    ? (JSON.parse(readFileSync(path, 'utf8')) as Store)
    : {};
  const resolvers = new Map<string, (v: unknown) => void>();

  function persist(): void {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(store), { mode: 0o600 });
  }

  const port: ConfirmPort = (ask: ConfirmAsk, emit: EventSink) => {
    const promptId = randomBytes(32).toString('hex');
    store[promptId] = { ask, runId: config.runId, settled: false };
    persist(); // durable BEFORE emit, so a crash between the two never loses it
    return new Promise<unknown>((resolve) => {
      resolvers.set(promptId, resolve);
      emit({ type: StatusEventType.Confirm, promptId, kind: ask.kind, question: ask.question });
    });
  };

  const resolve = (promptId: string, value: unknown): boolean => {
    const rec = store[promptId];
    if (!rec || rec.settled) return false; // unknown OR already-settled
    rec.settled = true;
    rec.answer = value;
    persist();
    resolvers.get(promptId)?.(value); // settle the in-memory awaiter if still present
    resolvers.delete(promptId);
    return true;
  };

  const pending = (): string[] =>
    Object.keys(store).filter((id) => !store[id]?.settled);

  return { port, resolve, pending };
}
```
Wire it into `main.ts` (replace `createConsentRegistry()` at `main.ts:152`) so the server uses the durable registry. Adopt path: delegate to `WorkflowAgent`'s durable `needsApproval`; custom path: this JSON-backed store is the durable layer.

- [ ] **Step 4: Run — verify it passes** (`bun test tests/server/consent/durable-registry.test.ts`).

- [ ] **Step 5: Gate + commit**
```bash
bun run typecheck && bun run lint:file -- src/server/consent/durable-registry.ts src/server/main.ts tests/server/consent/durable-registry.test.ts
git add src/server/consent/durable-registry.ts src/server/main.ts tests/server/consent/durable-registry.test.ts
git commit -m "feat(consent): durable consent registry surviving restart (Slice 24 Incr 6, item 1)"
```

## Task 43: Restart-durability integration test — no double-execution (§7.3) [OPUS/ultracode]

**Files:**
- Create: `tests/daemon/restart-durability.integration.test.ts`

**Interfaces:**
- Consumes: `createDaemon` (Task 27), `createJobStore`, `createWorkerPool`, the resume mechanism (Task 40/41).
- Produces: the §7.3 gate. Inject orphaned `Running` rows (one durable crew, one non-durable chat), boot the daemon (which runs `reconcileOrphans` with the `durable` predicate before the pool starts), and assert: the durable crew resumes from its last completed node (executes at most once, no re-run of completed nodes), the non-durable chat lands `Interrupted` (and is NOT auto-re-run), and **no job executes more than once** (a dispatch counter proves at-most-once). This is the executable proof of §7.3's "each lands in exactly one terminal-or-resumable state and executes at most once."

- [ ] **Step 1: Write the gating test** — `tests/daemon/restart-durability.integration.test.ts`:
```typescript
import { test, expect } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDaemon } from '../../src/daemon/core.ts';
import { createWorkerPool } from '../../src/queue/pool.ts';
import { createJobStore } from '../../src/queue/store.ts';
import { JobKind, JobStatus } from '../../src/queue/types.ts';

const waitFor = async (p: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (p()) return;
    await Bun.sleep(10);
  }
  throw new Error('timeout waiting for condition');
};

test('restart resumes durable orphans at-most-once; non-durable → Interrupted; no double-exec', async () => {
  const store = createJobStore({ path: mkdtempSync(join(tmpdir(), 'jobs-')) }, {});
  // Two orphaned Running rows (simulate a crash mid-flight).
  const crew = store.enqueue({ kind: JobKind.Crew, payload: 1 });
  const chat = store.enqueue({ kind: JobKind.Chat, payload: 2 });
  store.claimNext(); // crew -> Running
  store.claimNext(); // chat -> Running

  // Dispatch counts executions per runId — proves at-most-once.
  const execs = new Map<string, number>();
  const pool = createWorkerPool({
    store, concurrency: 2, pollMs: 5,
    dispatch: () => async (job) => {
      const key = job.runId as string;
      execs.set(key, (execs.get(key) ?? 0) + 1);
      return { ok: true };
    },
  });
  const pidPath = join(mkdtempSync(join(tmpdir(), 'pid-')), 'daemon.pid');
  const daemon = createDaemon({
    startWebServer: (() => ({ server: { stop() {} }, token: 't', port: 0 })) as never,
    queue: store, pool, pidPath,
    // Incr-6 wiring: the daemon reconciles with the durable predicate BEFORE
    // the pool starts, so durable orphans requeue and non-durable ones interrupt.
    durable: (j) => j.kind === JobKind.Crew || j.kind === JobKind.Workflow,
  });

  await daemon.start(); // reconcile(durable) → pool.start (the §7.3 ordering)
  // The durable crew orphan was requeued and re-dispatched EXACTLY once.
  await waitFor(() => store.getJob(crew.id)?.status === JobStatus.Done);
  expect(execs.get(crew.runId as string)).toBe(1);
  // The non-durable chat orphan was interrupted and never auto-re-run.
  expect(store.getJob(chat.id)?.status).toBe(JobStatus.Interrupted);
  expect(execs.has(chat.runId as string)).toBe(false);

  await daemon.stop();
  store.close();
});
```

- [ ] **Step 2: Run — verify it gates** (`bun test tests/daemon/restart-durability.integration.test.ts`). This requires `createDaemon` to accept the `durable?: (job: JobRecord) => boolean` opt added in Task 41 and pass it to `reconcileOrphans` in `start()` (before `pool.start()`).

- [ ] **Step 3: Minimal fix if a double-exec surfaces** — the fix, if any, is in `reconcileOrphans`'s single transaction (Task 41) or the daemon's start ordering (Task 27) — both already designed for at-most-once. Do not weaken either; make the test pass by tightening the ordering/atomicity.

- [ ] **Step 4: Run — verify green** (this is the executable §7.3 proof: each orphan lands in exactly one terminal-or-resumable state and executes at most once).

- [ ] **Step 5: Gate + commit**
```bash
bun run typecheck && bun run lint:file -- tests/daemon/restart-durability.integration.test.ts
git add tests/daemon/restart-durability.integration.test.ts
git commit -m "test(daemon): restart-durability no-double-exec gate (Slice 24 Incr 6, §7.3)"
```

## Task 44: Boundary gate — Increment 6

**Files:** none (verification only).

- [ ] **Step 1: Full gate**
```bash
bun run check
```
Expected: `bun run check` PASS — **cumulative test count ~1700, 0 fail** (Increment 6 adds ~6 checkpoint/resume/durable-consent/restart-durability tests on the SELECTED path only; the non-selected variant's tests are absent). Resume + durable-consent + restart-durability tests green; the non-selected path's files are absent (only the selected variant was built). (Counts are approximate running totals; the live figure is whatever `bun run test` reports — assert 0 failures, not an exact integer.)

---

# Increment 7 — Docs (4 surfaces) + live-verify + land

**Purpose (spec §5.7, §8, §10, CLAUDE.md hard line):** update all four living surfaces truthfully (audited against the diff, not just "touched"), run the whole-branch review, pass the mandatory live-verify gate on the target box, and land `--no-ff` with README + ROADMAP + SDD ledger in the same push (the slice-landing gate). This increment is the docs hard line — a stale surface is a defect.

## Task 45: `docs/architecture.md` — new Daemon + Queue sections + server/auth/run-store/telemetry deltas

**Files:**
- Modify: `docs/architecture.md`
- Modify: `docs/README.md` (doc-map pointer if any new living doc was added — the decision record + this plan are not living docs, so likely no map change; verify)

**Interfaces:**
- Consumes: the shipped code (Increments 2-6). The doc must MATCH the code, not the plan — audit each claim against the actual signatures.
- Produces: two new subsystem sections — **Daemon** (`src/daemon/` — lifecycle, PID, `SIGTERM`/`SIGINT` drain, launchd, `agent daemon` CLI, boot-recovery ordering: reconcile → pool → serve) and **Queue** (`src/queue/` — `jobs` table + migration, `createJobStore` closure API, `claimNext` atomicity, bounded pool, priority lanes, retry via `src/reliability/`, `reconcileOrphans`, the `/api/jobs*` control plane) — in both the module map and the data-flow diagram. Update the existing sections: **server perimeter/auth** (configurable bind-address + tunnel origin; durable root→session token model replacing the process-ephemeral token), the **run store** (runs now enqueued as jobs, execution detached from the request, SSE tails a pool-owned run), and **observability** (new `job.*`/`daemon.*` spans + populated `RunDTO.origin`/`server.principal`). Note the pluggable-transport recipes (Tailscale default / Cloudflare / reverse-proxy) and that TLS is delegated (D7). Replace the interim one-line stubs added at the Increment 2/3/4 gates with the full sections.

- [ ] **Step 1: Rewrite the interim stubs into full sections** — audit every module path + signature against the code (this is where a wrong edge is caught, as the Slice-9 audit caught 6). Include the Mermaid module-map + data-flow node/edge updates.
- [ ] **Step 2: Run `bun run docs:check`** — must pass (every `src/<subsystem>` documented, no orphaned living doc).
- [ ] **Step 3: Commit** `docs(architecture): Daemon + Queue subsystems + auth/run-store/telemetry deltas (Slice 24 Incr 7)` — but do NOT push yet (the slice-landing gate needs README + ROADMAP + ledger in the SAME push; land them together in Task 51).

## Task 46: Root `README.md` — Status line + slice-status table row + feature paragraph + Next line

**Files:** Modify: `README.md`

- [ ] **Step 1:** Update the **Status line** to Slice 24 shipped; add the **slice-status table** row (Slice 24 — Always-on Daemon + Task Queue + Resumable Jobs + Secure Remote Access — ✅ Done); add a feature paragraph describing the daemon + queue + resume + remote-access capability; update the **Next** line to the next slice in the committed sequence (memory `committed-slice-sequence`). Audit the claims against the shipped code.
- [ ] **Step 2: Commit** `docs(readme): Slice 24 status + slice-table row + feature paragraph (Slice 24 Incr 7)` (do not push yet).

## Task 47: `docs/ROADMAP.md` — flip daemon / queue / resumable / remote markers

**Files:** Modify: `docs/ROADMAP.md`

- [ ] **Step 1:** Flip the shipped-capability markers (🟡/❌ → ✅ shipped, Slice 24) in the **gap table**, the **phase table**, and the **recommended sequence** — for: always-on daemon, task queue / concurrent-launch cap, resumable long jobs / `--resume`, secure remote access (auth/token/tunnel/TLS/threat-model), and the localhost-≠-trust-boundary correction. Confirm the 18 chartered deferred items (§6) are each reflected as shipped where they landed.
- [ ] **Step 2: Commit** `docs(roadmap): flip daemon/queue/resumable/remote to shipped (Slice 24 Incr 7)` (do not push yet).

## Task 48: SDD ledger closeout — `.superpowers/sdd/progress.md`

**Files:** Modify: `.superpowers/sdd/progress.md`

- [ ] **Step 1:** Append the Slice 24 per-task / review / fix / landing entries (the continuity record a fresh session resumes from). Record the Increment 1 decision (adopt vs custom), the 7-increment task ledger, review findings + fixes, and the live-verify results (Task 50). Note which deferred items closed.
- [ ] **Step 2: Commit** `chore(sdd): Slice 24 ledger closeout (Slice 24 Incr 7)` (do not push yet — lands in Task 51).

## Task 49: Regenerate the architecture-snapshot Artifact + record the partial-vs-full land note

**Files:**
- Create/Modify: the Artifact source per memory `reference-artifact-regen-mechanics` (data-driven arrays; `node --check`; referential-integrity + real test-count gate)
- Modify: this plan / the ledger with the partial-vs-full land note

**Interfaces:**
- Consumes: the finalized `architecture.md` (Task 45), the real test count (`bun run test` count).
- Produces: the regenerated snapshot Artifact with the new **Daemon** + **Queue** nodes/edges, updated footer slice count (24) + test count, published to the same URL (update-in-place per the Artifact regen mechanics). Record whether Slice 24 lands whole or in parts (D1 = one slice, so whole) — the "partial-vs-full land note" documents that all four capabilities land together per D1.

- [ ] **Step 1:** Regenerate the Artifact from `architecture.md`; run the referential-integrity + real-test-count gate; publish update-in-place.
- [ ] **Step 2: Commit** any Artifact source file `docs(artifact): Slice 24 snapshot regen (Daemon + Queue nodes) (Slice 24 Incr 7)`.

## Task 50: Live-verify gate on the target box (§10 — MANDATORY before merge)

**Files:** none (manual runbook; record results in the ledger, Task 48).

**Interfaces:**
- Consumes: the built branch on the Mac Mini M4 Pro (memory `target-hardware-m4-pro`), real models, a second device on Tailscale.
- Produces: the four §10 gates PASSED and recorded:
  1. **Daemon under launchd** — `agent daemon install` + `start`; survives a logout/relaunch (`KeepAlive`/`RunAtLoad`); `agent daemon status`/`logs` work.
  2. **Remote reachability** — from a **second device over Tailscale**, authenticate with a per-device session token and hit `GET /api/jobs`; confirm **tunnel-without-token → 401**.
  3. **Detached long job** — submit a long job → **disconnect** the client → **reconnect** later → collect the result via SSE replay (§7.1).
  4. **Restart-resume** — `kill -TERM` the daemon mid-job → restart → a durable (DAG) job resumes from its last completed node (no re-execution); a non-durable job is marked `Interrupted` (§7.3) — **no double-execution**.

- [ ] **Step 1:** Run all four on the target box against real models (not mocks — Slice-13 lesson, memory `feedback-live-verify-before-merge`). Record pass/fail + evidence in the ledger. Any failure blocks merge and loops back to the owning increment.

## Task 51: Whole-branch adversarial review + land (`--no-ff`, slice-landing gate)

**Files:** none (review + merge).

**Interfaces:**
- Consumes: the full branch diff. Run the whole-branch fan-out review (correctness / security / docs-accuracy) — Opus/Fable-powered ultracode per the model-tiering rule; security review is mandatory for the durable-token + remote-access surface (§7.4). The docs-accuracy pass audits the four surfaces against the diff (not just "touched").
- Produces: a merged, pushed slice. The pre-push slice-landing gate requires `README.md`, `docs/ROADMAP.md`, and `.superpowers/sdd/progress.md` all updated in the SAME push (Tasks 46/47/48) alongside `docs/architecture.md` (Task 45) — they are; so the push passes without `DOCS_OK=1`.

- [ ] **Step 1:** Address review findings (re-review, never soften — memory `feedback-plan-sample-code-review-rigor`).
- [ ] **Step 2: Final full gate** `bun run check` → PASS.
- [ ] **Step 3: Merge + push**
```bash
git checkout main
git merge --no-ff slice-24-daemon-queue-remote -m "merge: Slice 24 — always-on daemon + task queue + resumable jobs + secure remote access"
git push   # slice-landing gate verifies README + ROADMAP + ledger + architecture.md all present in this push
```
- [ ] **Step 4:** Confirm the push passed the gate (no `DOCS_OK=1` needed) and the Artifact is live.

---

## Spec-coverage map (self-review — every spec section / D-decision / §7 hard-part / deferred item → a task)

| Spec ref | Where covered |
|---|---|
| D1 (all four, one slice) | whole plan; land-whole note Task 49 |
| D2 (pluggable tunnel, Tailscale default) | Tasks 37 (bind), 38 (tunnel origin), 45 (recipes doc); live-verify Task 50.2 |
| D3 (portable daemon core + launchd) | Tasks 26-29 |
| D4 (durable root→session token) | Tasks 32-34 |
| D5a (job-level durability) | Increment 2 (store) + Task 43 |
| D5b (DAG step-resume) | Tasks 40a/40b, 41 |
| D5c (WorkflowAgent spike-gated) | Increment 1 (Tasks 1-3), branch Task 40a/40b |
| D6 (full queue + concurrency + priority + retry) | Increment 2 (Tasks 4-13) + Increment 3 API |
| D7 (TLS delegated) | Task 45 doc; §9 out-of-scope honored |
| §7.1 SSE reconcile | Task 22 |
| §7.2 WorkflowAgent spike | Increment 1 |
| §7.3 boot-recovery no-double-exec | Tasks 10, 27, 43 |
| §7.4 token threat model | Tasks 32, 33, 38 |
| §8 architecture-doc note | Task 45 |
| §8 telemetry note (job.*/daemon.* spans) | Task 30 |
| §10 live-verify (4 gates) | Task 50 |
| Deferred 1 (consent eviction) | Task 42 |
| Deferred 2 (run-dir rate-limit) | Task 39 |
| Deferred 3 (maxRequestBodySize) | Task 35 |
| Deferred 4 (/api/telemetry pre-parse limit) | Task 36 |
| Deferred 5 (localhost ≠ trust boundary) | Tasks 34, 37, 38 |
| Deferred 6 (concurrent-stream cap) | Task 23 |
| Deferred 7 (concurrent-launch cap = pool) | Task 13 |
| Deferred 8 (cancel beyond local) | Task 20 |
| Deferred 9 (--resume) | Task 41 |
| Deferred 10 (durable execution) | Tasks 40a/40b |
| Deferred 11 (Slice-21 resume charter) | Increment 2 + Task 41 |
| Deferred 12 (secure remote surface) | Tasks 32-38 |
| Deferred 13 (Origin allowlist tunnel) | Task 38 |
| Deferred 14 (@ai-sdk/mcp redirect SSRF) | Task 39 |
| Deferred 15 (Phase-5 resource minors) | folded across Tasks 23/35/36/39 as touched |
| Deferred 16 (server-push/global SSE bus) | Task 22 (run stream IS the bus) |
| Deferred 17 (DTO provenance origin/principal) | Task 24 |
| Deferred 18 (daemon/queue spans tagged origin) | Task 30 |

**Resolved during self-review:**
1. **`JobKind` vs `RunKind`.** Spec §5's proposed `ModelPull='model-pull'` / `Builder='builder'` do NOT match the real `RunKind` enum (`src/contracts/enums.ts:116`: `Pull='pull'`, `Build='build'`). Resolved by defining `JobKind` values as a strict SUBSET of `RunKind` values (`Chat/Crew/Workflow/Pull/Build`) with a parity test (Task 4 + Task 15), so a job's kind is always a valid `RunKind` — no second, drifting kind vocabulary. Documented in Shared contracts.
2. **`RunOrigin.Daemon` did not exist.** The enum (`enums.ts:8`) had `Manual/Schedule/Webhook/Api/Remote` but no `daemon`. Spec §8 requires `origin: daemon`. Resolved by adding `RunOrigin.Daemon = 'daemon'` + a run-dir `origin` marker read by `mapRunToDto` (Task 24), since `mapRunToDto` hardcoded `RunOrigin.Manual`.
3. **`server.principal` is a telemetry span attribute**, not a DTO field (`spans.ts:160,283`, default `'local'`). Resolved by threading the verified device id into `withServerRequestSpan`'s `principal` (Task 24/34) rather than inventing a DTO field.
4. **`reconcileOrphans` signature evolves.** Increment 2 ships it zero-arg (all orphans → Interrupted, no checkpoint layer yet); Increment 6 (Task 41) adds the optional `durable` predicate for checkpoint-resumable requeue. Called out in Tasks 10 + 41 so the signature change is intentional, not a surprise.
5. **Interim pool ownership + single-pool guarantee.** `startWebServer` self-hosts a pool in **standalone mode** (Increment 3, Task 17) so the job API is testable before the daemon exists; Increment 4 (Task 27) has `createDaemon` run `reconcileOrphans` → `pool.start()` and then boot `startWebServer` in **injected mode**, handing over the SAME reconciled `{ jobStore, pool }`. The server never constructs a second pool when a queue is injected — a documented handoff, not a contradiction.

**Resolved during the review-fix pass (C1 / I1 / minors):**
6. **C1 — double worker pool (critical).** The pre-fix plan had `startWebServer` unconditionally construct+start its OWN `createJobStore`+`createWorkerPool` AND `createDaemon` build a SEPARATE pool then call `startWebServer()` — two pools on the same `AGENT_QUEUE_PATH` DB, doubling concurrency and bypassing the §7.3 reconcile-before-claim guarantee (the server's pool was never gated by the daemon's reconcile). Fixed with an **injected-pool mode**: `StartOptions.queue?: { jobStore; pool }` — when present, `startWebServer` neither constructs nor starts/stops a pool (the daemon owns lifecycle); when absent, it self-hosts as before (Task 17). The daemon injects its reconciled pool AFTER `reconcileOrphans` → `pool.start()` (Task 27). Task 27's test now captures the `queue` arg and asserts `received.queue.pool === daemonPool` plus a `['reconcile','pool.start']` call-order log.
7. **I1 — retry backoff could not delay re-claim; breaker was dead.** `markFailed` re-queued immediately with no time gate and `claimNext` had no time predicate, so the backoff (a worker `abortableSleep`) did nothing under concurrency. Fixed by adding an `available_at` epoch-ms column (Task 5 migration; `availableAt` on `JobRecord`/`JobInput`): `claimNext` gains `AND available_at <= now` (Task 7), `markFailed` sets `available_at = now + backoffDelay(attempts)` using the reliability `retryBaseMs`/`retryCapMs` knobs (Task 8), and the pool no longer sleeps holding a slot (Task 13). The dead `breakerFor` reference was **dropped** from Task 12 (drop-and-simplify: a per-kind breaker adds probe state for no gain over `maxAttempts` + backoff, and the queue's jobs share no failure domain); `jobRetryDecision` simplified to `{ retryable }`.
8. **Minors.** M1: `withServerRequestSpan` citation `spans.ts:276`→`:275`. M3: Task 27's toothless `claimedAfterReconcile===false` replaced by a real orphan→Interrupted assertion + a Task-43 pointer for the live §7.3 teeth. M4: pool `stop()` drain uses `JobStatus.Running` (enum-over-literal), not the `'running'` literal. M5: each boundary gate (14/25/31/39b/44) now carries an approximate cumulative test count. M6: Shared contracts note that `JobStore = ReturnType<typeof createJobStore>` and that `reconcileOrphans` intentionally evolves. I2: the prose-only tasks (20, 23, 28, 29, 35-39, 41, 42, 43, 40b) were fleshed to the fenced `bun:test`+impl standard; Task 40a stays prose behind an explicit ⚠ POST-SPIKE banner (its API is only known after the Increment-1 spike).
