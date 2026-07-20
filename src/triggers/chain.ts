/**
 * §7.3 job-chain observer — the completion side of the `jobchain` trigger
 * source. The worker pool calls `handleJobSettled` ONLY on a job's TERMINAL
 * settle (Done/Failed — never a retry re-queue, cancel, or interrupt; see the
 * `onSettled` seam in `src/queue/pool.ts`). For every enabled jobchain trigger
 * whose matcher accepts the finished job, it fires the chained target through
 * the single `fire.ts` convergence point.
 *
 * TRUST BOUNDARY (F1 carry): the fired job's `chainDepth` is derived HERE from
 * the FINISHED job's PERSISTED `chainDepth` (+1 per hop) — never from any
 * client/external input. `fire.ts` (Task 9) caps that depth (the A→B→A runaway
 * guard); this observer always increments and delegates, so the cap is enforced
 * at the one place all four trigger sources funnel through.
 */

import type { JobRecord, JobStatus } from '../queue/types.ts';
import type { FireTrigger } from './fire.ts';
import type { TriggerStore } from './store.ts';
import { type JobChainConfig, TriggerType } from './types.ts';

type SettledStatus = JobStatus.Done | JobStatus.Failed;

export type ChainObserver = {
  handleJobSettled: (job: JobRecord, status: SettledStatus) => void;
};

/** The finished job's target name for `onName` matching. Crew/workflow job
 *  payloads are `{ name, input }` (see `src/server/jobs/dispatch.ts`); kinds
 *  without a name (chat/pull/build) yield `undefined`, so an `onName` filter
 *  never matches them. */
function payloadName(payload: unknown): string | undefined {
  if (payload !== null && typeof payload === 'object' && 'name' in payload) {
    const name = (payload as { name?: unknown }).name;
    return typeof name === 'string' ? name : undefined;
  }
  return undefined;
}

function matches(
  config: JobChainConfig,
  job: JobRecord,
  status: SettledStatus,
): boolean {
  if (config.onStatus !== status) return false;
  if (config.onKind && config.onKind !== job.kind) return false;
  if (config.onName && config.onName !== payloadName(job.payload)) return false;
  return true;
}

export function createChainObserver(deps: {
  triggerStore: TriggerStore;
  fire: FireTrigger;
  // Present for interface parity; the depth cap itself lives in fire.ts (the
  // single convergence point), so the observer always increments + delegates.
  maxChainDepth: () => number;
}): ChainObserver {
  return {
    handleJobSettled(job, status): void {
      for (const trigger of deps.triggerStore.list()) {
        // The TriggerConfig union is non-discriminated (T1 carry): branch on
        // trigger.type EXPLICITLY before narrowing the config.
        if (!trigger.enabled || trigger.type !== TriggerType.JobChain) continue;
        if (!matches(trigger.config as JobChainConfig, job, status)) continue;
        // F1: fired depth derives from the FINISHED job's PERSISTED chainDepth.
        // fire() is fire-and-forget from this synchronous seam — swallow any
        // rejection so a chain-fire failure never surfaces as an
        // unhandledRejection (the pool wraps synchronous throws, not promises).
        void deps
          .fire(trigger, {
            reason: 'chain',
            chainDepth: (job.chainDepth ?? 0) + 1,
            vars: { 'chain.jobId': job.id, 'chain.runId': job.runId ?? '' },
          })
          .catch(() => {
            /* degrade: a chain fire failure must not wedge the settle path */
          });
      }
    },
  };
}
