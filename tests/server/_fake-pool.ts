import type { WorkerPool } from '../../src/queue/pool.ts';

/**
 * A fake `WorkerPool` for test harnesses that build a `ServerDeps` but don't
 * exercise `POST /api/jobs/:id/cancel` (or any other pool-reading route) —
 * `pool` is a required `ServerDeps` field (Slice 24 T20), so every harness
 * needs SOME value here even when its tests never touch it. Matches the real
 * `WorkerPool` interface in `src/queue/pool.ts` exactly; `cancel` always
 * returns `false` (no controller ever registered) since nothing in these
 * suites ever runs a job through this fake pool.
 */
export function makeFakePool(): WorkerPool {
  return {
    start: () => {},
    stop: async () => {},
    cancel: () => false,
    activeCount: () => 0,
  };
}
