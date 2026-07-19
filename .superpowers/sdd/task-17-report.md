# Task 17 — Wire queue + pool into ServerDeps + boot (interim host) — report

**Commits:** `1cd5065` (feature) + `f0afd59` (gitignore `/jobs/`)
**Branch:** slice-24-daemon-queue-remote

## The C1 injected-pool contract (StartOptions.queue) — both-mode branching

`StartOptions` gained an OPTIONAL injected queue; `startWebServer`'s return gained `jobStore`/`pool`:

```ts
export type StartOptions = {
  ...
  queue?: { jobStore: JobStore; pool: WorkerPool };
};
export function startWebServer(opts: StartOptions = {}): {
  server; token; port; jobStore: JobStore; pool: WorkerPool;
}
```

Branch (main.ts, after the run-turn construction):

```ts
const injected = opts.queue;
const jobStore =
  injected?.jobStore ?? createJobStore({ path: String(cfg.AGENT_QUEUE_PATH) }, {});
let pool: WorkerPool;
if (injected) {
  pool = injected.pool;                 // caller (daemon) owns lifecycle: NO start/stop/close
} else {
  const dispatch = createJobDispatch({
    runCrewTurn, getCrew, runWorkflowTurn, getWorkflow,
    runModelPull, runChatTurn, runBuilderTurn,
  });
  pool = createWorkerPool({ store: jobStore, concurrency: computeConcurrency(),
                            dispatch, pollMs: cfg.AGENT_QUEUE_POLL_MS as number });
  pool.start();
  onShutdown(async () => { await pool.stop(); jobStore.close(); });
}
```

- **Injected mode** — reuses the caller's exact `{ jobStore, pool }`, does NOT construct/start/stop/close. Returns the same instances. This is the §7.3 double-pool fix: the daemon (T27) already ran `reconcileOrphans()` → `pool.start()` and owns the drain; a second pool on the same `AGENT_QUEUE_PATH` DB would double concurrency + bypass reconcile-before-claim.
- **Standalone mode** — self-hosts `createJobStore` + `createWorkerPool(createJobDispatch(...))` (concurrency = `computeConcurrency()`/`AGENT_QUEUE_CONCURRENCY`, dispatch = the T16 registry with the real crew/workflow/pull/chat/build turns + `getCrew`/`getWorkflow`), starts it, and stops+closes on shutdown via `onShutdown`.

`ServerDeps` gained `jobStore: JobStore` (routes land T18-20; nothing added to the if-ladder yet). `jobStore` is threaded into the `deps` object.

## Chat-runId seam (resolved the T16 carry-over)

`RunChatTurn`'s input type gained an optional `runId?: string`; `createRealRunChatTurn` threads it into `withMcpRun`:

```ts
return async ({ task, media, events, stream, signal, runId }) => {
  const registry = await engine.registry();
  return withMcpRun(
    { runsRoot: engine.runsRoot, runId: runId ?? newRunId() },  // inject or self-mint
    ...);
```

`src/server/jobs/dispatch.ts` Chat executor now passes `runId: requireRunId(job)` (was self-minting). So for an enqueued chat job the run dir === `job.runId` (the id returned as `202 {runId}`), and `/api/runs/:runId/stream` polling resolves for chat jobs — same invariant already held for crew/workflow/pull/build. The synchronous `POST /api/chat` path passes no runId, so it still self-mints (behavior unchanged).

**Proof test** (`main-queue-boot.test.ts`): `createRealRunChatTurn(fakeEngine, throwingMemory)` invoked with `runId: 'run-injected-chat-0001'`. `withMcpRun`'s first act is `createRun(runsRoot, runId)` (creates the dir), then the throwing memory store aborts the turn before any model call → assert `existsSync(runsRoot/run-injected-chat-0001)`. Also `dispatch.test.ts` chat case now asserts the executor threads `job.runId` into `RunChatTurn`.

## TDD RED → GREEN

- Wrote `tests/server/main-queue-boot.test.ts` first: standalone (enqueue persists + `pool.activeCount()` callable), injected (`handle.pool === pool`, `handle.jobStore === jobStore`, `start`/`stop` never called), chat-runId run-dir. RED: `TypeError: handle.pool.stop` undefined / `handle.pool` undefined / run dir absent (self-minted).
- Implemented → GREEN: 3/3. Full `tests/server/ tests/queue/` = 275 pass / 0 fail. typecheck 0, lint clean, docs-check ✔.

## Files changed
- `src/server/main.ts` — imports, `StartOptions.queue`, return type, inject-or-self-host branch, `jobStore` in deps + return.
- `src/server/app.ts` — `ServerDeps.jobStore: JobStore` + type import.
- `src/server/chat/run-turn.ts` — `RunChatTurn.runId?` + thread into `withMcpRun`.
- `src/server/jobs/dispatch.ts` — chat executor passes `job.runId`; updated the resolved-seam comment.
- Tests: new `main-queue-boot.test.ts`; `dispatch.test.ts` chat runId assertion; 8 fixtures (`app`, `runs-routes`, `phase4-routes`, `phase5-mcp-routes`, `phase5-memory-routes`, `sessions-routes`, `sessions-export`) gain a `jobStore` stub (`{} as unknown as JobStore`, matching the existing throwing-stub convention).
- `.gitignore` — added `/jobs/` (standalone boot now self-hosts the queue DB at the default `AGENT_QUEUE_PATH`, like `/runs/` `/sessions/` `/memory/`).

## Concerns
- **`/jobs/` pollution (fixed):** wiring the pool into boot means every standalone `startWebServer` (incl. the existing `main.test.ts`) now creates `./jobs/jobs.db` at the default path. Added `/jobs/` to `.gitignore` (commit `f0afd59`). Tests that want isolation should set `AGENT_QUEUE_PATH` to a tmp dir (the new boot test does).
- **docs:** `src/server/**` and `src/queue/**` are already documented; no new subsystem dir, so no `architecture.md` stub needed (docs-check green). The living-doc surfaces (README/ROADMAP/architecture/Artifact) are the slice-landing gate's job when Incr 3 lands on main, not this per-task commit.
- Injected mode is exercised with a fake pool here; the real daemon-owned wiring lands in T27.
