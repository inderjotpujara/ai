import { explain } from '../errors/boundary.ts';
import { abortableSleep } from '../reliability/retry.ts';
import { jobRetryDecision } from './retry-policy.ts';
import type { JobStore } from './store.ts';
import { type JobKind, type JobRecord, JobStatus } from './types.ts';

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
      loops = Array.from({ length: Math.max(1, opts.concurrency) }, () =>
        loop(),
      );
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
