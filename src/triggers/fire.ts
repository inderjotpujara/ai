/**
 * §7.3 — the single convergence point through which ALL four trigger sources
 * (cron/webhook/file/chain) plus manual test-fires enqueue jobs. Everything the
 * engine guarantees funnels through here so no source can bypass it:
 *   - chain-depth cap (runaway A→B→A cycle guard),
 *   - overlap protection (skip while the previous fired job is still in flight),
 *   - provenance stamping (RunOrigin per source),
 *   - the firing audit trail (a `trigger_firings` row on EVERY outcome), and
 *   - the `trigger.fire` root span (Task 8).
 *
 * Template substitution of the target payload is PLAIN string/JSON
 * interpolation (`substituteTemplate`) — never `eval`/`Function`/a template
 * engine (§7.3).
 */

import { RunOrigin } from '../contracts/enums.ts';
import type { JobStore } from '../queue/store.ts';
import { JobStatus } from '../queue/types.ts';
import { newRunId } from '../run/run-id.ts';
import { createRun } from '../run/run-store.ts';
import { recordTriggerSkip, withTriggerFireSpan } from './spans.ts';
import type { TriggerStore } from './store.ts';
import { substituteTemplate } from './substitute.ts';
import {
  type CronConfig,
  type Trigger,
  TriggerOutcome,
  TriggerType,
} from './types.ts';

export type FireReason = 'cron' | 'webhook' | 'file' | 'chain' | 'manual';

export type FireContext = {
  reason: FireReason;
  vars?: Record<string, string>;
  // Depth of the job ABOUT to be created (chain hops). TRUST BOUNDARY: callers
  // MUST derive this from the source job's persisted chainDepth (+1 per hop);
  // never accept a client-supplied value. Caller-side enforcement lands in
  // T13/T24 (F1 carry). A non-integer/negative value is rejected here as
  // cap-exceeded (see N2 clamp below).
  chainDepth?: number;
  bypassOverlap?: boolean; // manual test-fire ignores overlap protection
};

export type FireResult =
  | { fired: true; jobId: string; runId: string }
  | { fired: false; outcome: TriggerOutcome };

export type FireTrigger = (t: Trigger, ctx: FireContext) => Promise<FireResult>;

// Provenance mapping (spec D3): cron→Schedule, webhook→Webhook, and
// file/chain/manual all→Api (they are all API-surface-driven enqueues).
const ORIGIN_FOR: Record<FireReason, RunOrigin> = {
  cron: RunOrigin.Schedule,
  webhook: RunOrigin.Webhook,
  file: RunOrigin.Api,
  chain: RunOrigin.Api,
  manual: RunOrigin.Api,
};

export function createFireTrigger(deps: {
  triggerStore: TriggerStore;
  jobStore: JobStore;
  runsRoot: string;
  maxChainDepth: () => number;
}): FireTrigger {
  return (t, ctx) =>
    withTriggerFireSpan(t, async (rec) => {
      const now = Date.now();
      // §7.3 chain-cycle guard: the depth of the job about to be created. A
      // chain fire passes ctx.chainDepth = finishedJob.chainDepth + 1; the cap
      // is enforced HERE (the single convergence point) so no source can bypass
      // it.
      const depth = ctx.chainDepth ?? 0;
      // N2 clamp: a supplied depth must be a non-negative integer. NaN /
      // negative / fractional are treated as cap-exceeded — NaN in particular
      // self-perpetuates through `depth + 1` hops (NaN > cap is false), so it
      // would slip past the numeric cap and drive an unbounded chain if it ever
      // reached ctx. Same over-cap outcome (Failed, plan-mandated), no enqueue.
      const overCap =
        (ctx.chainDepth !== undefined &&
          (!Number.isInteger(ctx.chainDepth) || ctx.chainDepth < 0)) ||
        depth > deps.maxChainDepth();
      if (overCap) {
        deps.triggerStore.recordFiring({
          triggerId: t.id,
          firedAt: now,
          outcome: TriggerOutcome.Failed,
        });
        rec.outcome(TriggerOutcome.Failed);
        return { fired: false, outcome: TriggerOutcome.Failed };
      }
      // Overlap protection: skip if the previous fired job is still in flight,
      // unless the trigger allows overlap or this is a manual test-fire.
      // Branch on trigger.type EXPLICITLY — the TriggerConfig union is
      // non-discriminated, so never structurally narrow the config.
      const allowOverlap =
        ctx.bypassOverlap === true ||
        (t.type === TriggerType.Cron &&
          (t.config as CronConfig).allowOverlap === true);
      // F2 TOCTOU fix: the overlap check → enqueue → recordFiring → update
      // span below is ONE yield-free synchronous block (bun:sqlite is sync).
      // The run-dir create — the only async step — is moved AFTER it, so two
      // concurrent fires (e.g. concurrent webhook deliveries) can no longer
      // both pass the check during each other's `await`: whichever runs first
      // completes the whole check+enqueue span before the second even starts.
      const runId = newRunId();
      if (!allowOverlap) {
        // FIX 1: latestFiredFiring (job_id IS NOT NULL), NOT latestFiring — a
        // skip/fail row has jobId=null, so latestFiring would let this tick
        // fall through the jobId check and breach overlap while the earlier
        // fired job is still in flight.
        const last = deps.triggerStore.latestFiredFiring(t.id);
        if (last?.jobId) {
          const prev = deps.jobStore.getJob(last.jobId);
          if (
            prev &&
            (prev.status === JobStatus.Queued ||
              prev.status === JobStatus.Running)
          ) {
            deps.triggerStore.recordFiring({
              triggerId: t.id,
              firedAt: now,
              outcome: TriggerOutcome.SkippedOverlap,
            });
            recordTriggerSkip(t, TriggerOutcome.SkippedOverlap);
            rec.outcome(TriggerOutcome.SkippedOverlap);
            return { fired: false, outcome: TriggerOutcome.SkippedOverlap };
          }
        }
      }
      const job = deps.jobStore.enqueue({
        kind: t.target.kind,
        payload: substituteTemplate(t.target.payload, ctx.vars ?? {}),
        origin: ORIGIN_FOR[ctx.reason],
        chainDepth: depth,
        runId,
      });
      // NOTE (M7) — the firing-audit row and the job enqueue span two
      // connections. `deps.jobStore.enqueue(...)` writes through the JobStore's
      // bun:sqlite handle and `deps.triggerStore.recordFiring(...)` through the
      // TriggerStore's — two separate handles onto the same jobs.db, not one
      // transaction. A crash in the sliver between them can leave a job
      // enqueued with no matching trigger_firings row (or, on the skip/fail
      // paths above, a firing row with no job). This is an audit-only gap — the
      // job itself is durable and runs normally; only the firing-history record
      // may be missing one entry. Accepted for this slice (unifying the writes
      // would couple the two stores' connection management for a cosmetic audit
      // record); documented rather than fixed. Related edge from the F2
      // reorder: because `createRun` now runs AFTER this enqueue + the Fired
      // recordFiring below, if createRun throws the job is durably enqueued and
      // the Fired row is written but fire() still throws — same audit-gap family
      // as M7 (durable job, best-effort bookkeeping), likewise accepted.
      deps.triggerStore.recordFiring({
        triggerId: t.id,
        firedAt: now,
        jobId: job.id,
        runId,
        outcome: TriggerOutcome.Fired,
      });
      // M5: last_fired_at is written HERE, only on an actual Fired outcome —
      // never on a skip/fail. claimDueCron deliberately does not bump it.
      deps.triggerStore.update(t.id, { lastFiredAt: now });
      // Create the run dir AFTER the yield-free enqueue span so an immediate
      // /api/runs/:id/stream never 404s once fireTrigger returns (mirrors
      // handleJobEnqueue). dispatch's markDaemonOrigin re-creates it
      // idempotently at execution time. This is the sole `await`, deliberately
      // outside the critical span (F2).
      await createRun(deps.runsRoot, runId);
      rec.outcome(TriggerOutcome.Fired);
      return { fired: true, jobId: job.id, runId };
    });
}
