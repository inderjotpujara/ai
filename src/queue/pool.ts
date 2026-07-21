import {
  recordJobCancel,
  recordJobRetry,
  withJobRunSpan,
} from '../daemon/spans.ts';
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
  /**
   * Graceful drain. With no arg, awaits every in-flight job unbounded (today's
   * behavior). With `drainTimeoutMs`, races the drain against that deadline and,
   * on timeout, proceeds to the Running→Interrupted sweep anyway so a
   * pathological executor that ignores its abort signal cannot hang shutdown.
   */
  stop(drainTimeoutMs?: number): Promise<void>;
  cancel(jobId: string): boolean;
  activeCount(): number;
};

export function createWorkerPool(opts: {
  store: JobStore;
  concurrency: number;
  dispatch: (kind: JobKind) => JobExecutor;
  pollMs?: number;
  /**
   * §7.3 chain seam. Invoked AFTER a job reaches a TERMINAL transition only
   * (Done, or Failed with no retry left) — NEVER on a retry re-queue, cancel,
   * or interrupt. The call is wrapped (see `safeSettled`) so a throwing observer
   * can never break `runOne` or the claim loop. The job-chain observer
   * (`src/triggers/chain.ts`) plugs in here.
   */
  onSettled?: (
    job: JobRecord,
    status: JobStatus.Done | JobStatus.Failed,
  ) => void;
}): WorkerPool {
  const pollMs = opts.pollMs ?? 250;
  const controllers = new Map<string, AbortController>();
  const inFlight = new Set<Promise<void>>();
  let running = false;
  let loops: Promise<void>[] = [];

  // A settle observer must never wedge the claim loop: log-and-swallow anything
  // it throws (there is no logger wired at this layer; the daemon supplies a
  // wrapping onSettled if it wants failures recorded).
  function safeSettled(
    job: JobRecord,
    status: JobStatus.Done | JobStatus.Failed,
  ): void {
    try {
      opts.onSettled?.(job, status);
    } catch {
      /* observer error is not the pool's failure — degrade, never crash */
    }
  }

  async function runOne(job: JobRecord): Promise<void> {
    const controller = new AbortController();
    controllers.set(job.id, controller);
    try {
      const executor = opts.dispatch(job.kind);
      const result = await withJobRunSpan(job, () =>
        executor(job, controller.signal),
      );
      // A cancel() already flipped the row to Canceled — don't overwrite it.
      // NB: the aborted guard and the terminal write below are synchronous with
      // NO await between them — that is what preserves the single-terminal-
      // transition guarantee vs. a concurrent cancel(). The inner try/catch is
      // synchronous too, so it does not open an await window here.
      if (controller.signal.aborted) return;
      try {
        opts.store.markDone(job.id, result);
        // I5: chain-observe ONLY a completion that actually committed. This sits
        // INSIDE the try, immediately after markDone — a throwing markDone falls
        // to the catch below WITHOUT calling safeSettled, so no chained job is
        // fired off a completion that never committed (no phantom chain).
        safeSettled(job, JobStatus.Done);
      } catch {
        // Persistence failure (SQLITE_BUSY/FULL, DB closed mid-shutdown): swallow
        // rather than let it propagate out of runOne and kill the claim loop. The
        // row is left Running and will be reconciled to Interrupted later by
        // reconcileOrphans / stop()'s sweep. Degrade, never crash. onSettled NOT
        // called.
      }
    } catch (err) {
      if (controller.signal.aborted) return; // cancel path owns the transition
      // Classify retryability only; markFailed persists the backoff as
      // `available_at` (Task 8) and claimNext's time gate (Task 7) enforces it,
      // so the worker must NOT sleep here holding its slot.
      const { retryable } = jobRetryDecision(err);
      try {
        opts.store.markFailed(job.id, explain(err).title, retryable);
        // A re-queue (vs. terminal Failed) is a distinct lifecycle event from
        // job.run's own ERROR status — record it as `job.retry` so "how often
        // does this job kind retry" is answerable straight from the trace.
        // Re-read so job.attempt reflects the attempt that just failed.
        const after = opts.store.getJob(job.id);
        if (after?.status === JobStatus.Queued) recordJobRetry(after);
        // Terminal failure (retries exhausted / non-retryable): chain-observe it.
        // A re-queue (Queued above) is NOT terminal, so it never reaches here.
        // Inside the try so a throwing markFailed/getJob skips it too.
        else if (after?.status === JobStatus.Failed)
          safeSettled(after, JobStatus.Failed);
      } catch {
        // Same as markDone above: a terminal-write failure must NOT escape
        // runOne. Left Running → reconciled to Interrupted later.
      }
    } finally {
      controllers.delete(job.id);
    }
  }

  async function loop(): Promise<void> {
    while (running) {
      let job: JobRecord | null;
      try {
        job = opts.store.claimNext();
      } catch {
        // A store read failure (SQLITE_BUSY past busy_timeout, DB closed) must
        // NOT kill the claim loop — that would silently degrade concurrency
        // toward 0 while `running` stays true. Back off and retry.
        await abortableSleep(pollMs);
        continue;
      }
      if (!job) {
        await abortableSleep(pollMs);
        continue;
      }
      const p = runOne(job);
      inFlight.add(p);
      try {
        await p;
      } finally {
        // finally (not a bare post-await delete) so a rejecting runOne — which
        // shouldn't happen now, but belt-and-suspenders — never leaks the Set entry.
        inFlight.delete(p);
      }
    }
  }

  return {
    start(): void {
      if (running) return;
      running = true;
      loops = Array.from({ length: Math.max(1, opts.concurrency) }, () =>
        // .catch belt-and-suspenders: loop() is designed never to reject, but if
        // a future edit reintroduces a throw this guarantees no unhandledRejection
        // (which could crash the daemon) from these fire-and-forget promises.
        loop().catch(() => {
          /* swallow: loop is designed not to reject */
        }),
      );
    },
    async stop(drainTimeoutMs?: number): Promise<void> {
      running = false;
      for (const c of controllers.values()) c.abort();
      const drain = (async () => {
        await Promise.allSettled([...inFlight]);
        await Promise.allSettled(loops);
      })();
      if (drainTimeoutMs !== undefined) {
        // Bounded drain: on timeout, stop waiting on stragglers and proceed to
        // the sweep below (which reconciles them to Interrupted anyway). The
        // default (no arg) keeps the unbounded graceful drain.
        await Promise.race([drain, abortableSleep(drainTimeoutMs)]);
      } else {
        await drain;
      }
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
      // Read BEFORE markCanceled so job.cancel carries the job's kind/
      // priority/runId (markCanceled only touches status/finished_at).
      const job = opts.store.getJob(jobId);
      opts.store.markCanceled(jobId);
      if (job) recordJobCancel(job);
      return true;
    },
    activeCount: (): number => controllers.size,
  };
}
