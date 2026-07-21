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

