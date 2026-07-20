/**
 * The always-on daemon lifecycle (Slice 24 Increment 4). Owns the single
 * queue+pool and the web server, and — crucially — the §7.3 boot-recovery
 * ordering that makes a crash-and-restart safe against double-execution.
 *
 * `start()` runs a fixed sequence whose ORDER is the correctness core:
 *   1. Double-start guard — refuse if a LIVE daemon pid is already on record.
 *   2. `reconcileOrphans()` FIRST — before the pool can claim anything, so any
 *      `running` row left by a crash is moved to `interrupted` in the store's
 *      own transaction and can never be picked up mid-flight (§7.3).
 *   3. `writePid` — record this process as the running daemon.
 *   4. `pool.start()` — only now may workers begin claiming.
 *   5. `startWebServer({ queue: { jobStore, pool, concurrency } })` in INJECTED
 *      mode — the server reuses THIS reconciled, already-started pool and does
 *      NOT spin up a second one on the same DB (the §7.3 double-pool fix; see
 *      Task 17). `concurrency` (Slice 25b Task 11) is the SAME
 *      `computeConcurrency()` value `buildRealDaemon` (src/cli/daemon.ts) built
 *      `pool` with, so `/api/queue/stats` and `/api/daemon/status` never
 *      report a number that disagrees with the pool actually running.
 *   6. Register a shutdown drain + install signal handlers so SIGTERM/SIGINT
 *      drain gracefully via `stop()`.
 *
 * `stop()` drains the pool (interrupting stragglers), stops the server, and
 * clears the pid — idempotent, so a double-stop (e.g. signal + explicit call)
 * is safe. `status()` reports liveness straight from the pid file.
 */

import { installSignalHandlers, onShutdown } from '../process/lifecycle.ts';
import type { WorkerPool } from '../queue/pool.ts';
import type { JobStore } from '../queue/store.ts';
import type { JobRecord } from '../queue/types.ts';
import type { startWebServer as StartWebServer } from '../server/main.ts';
import type { TriggersEngine } from '../triggers/engine.ts';
import { clearPid, defaultPidPath, readLivePid, writePid } from './pid.ts';
import { recordDaemonStart, recordDaemonStop } from './spans.ts';

export type Daemon = {
  install(): void;
  start(): Promise<void>;
  stop(): Promise<void>;
  status(): { running: boolean; pid?: number };
};

export type CreateDaemonOptions = {
  startWebServer: typeof StartWebServer;
  queue: JobStore;
  pool: WorkerPool;
  /** The `computeConcurrency()` value `pool` was built with (Slice 25b Task
   *  11) — threaded into the injected `startWebServer({ queue: { ... } })`
   *  call below so the daemon-status/queue-stats routes report the SAME
   *  number the pool actually runs at, never a second, independently-computed
   *  one. The caller (`buildRealDaemon`, src/cli/daemon.ts) hoists this to a
   *  local shared with the `createWorkerPool` call — never calls
   *  `computeConcurrency()` twice. */
  concurrency: number;
  pidPath?: string;
  /** Bounded graceful-drain deadline handed to `pool.stop`. Undefined = the
   *  pool's default unbounded drain (await every in-flight job). */
  drainTimeoutMs?: number;
  /** launchd installer (Task 28), injected. */
  install?: () => void;
  /** Signal-handler installer, injected for tests so unit runs don't attach
   *  real process SIGINT/SIGTERM handlers. Defaults to the process-wide
   *  `installSignalHandlers`. */
  installSignals?: () => void;
  /** The triggers engine (Slice 25, Task 16), constructed + owned by the daemon
   *  (`buildRealDaemon`) alongside the pool. The daemon lifecycle-binds it: it is
   *  started AFTER the pool + server are up (step 5b — it is a PRODUCER, so it
   *  must never enqueue before the consumer is ready) and stopped FIRST in
   *  `stop()` (before the pool drains — stop producing before draining
   *  consumers, per D2). Forwarded through to the injected `startWebServer` so
   *  the /api/triggers* routes (Increment 5) resolve the SAME engine instance.
   *  Absent (Increments 4-5 unit tests) = no triggers wired. */
  triggers?: TriggersEngine;
  /** Reconcile predicate for durable-orphan requeue (Increment 6, Task 41):
   *  a Running orphan matching this predicate (crew/workflow) is re-queued at
   *  boot so the pool re-claims and resumes it from its checkpoint, instead of
   *  being Interrupted. Absent (Increments 4-5), reconcile is zero-arg and every
   *  orphan is Interrupted. */
  durable?: (job: JobRecord) => boolean;
};

export function createDaemon(opts: CreateDaemonOptions): Daemon {
  const pidPath = opts.pidPath ?? defaultPidPath();
  const installSignals = opts.installSignals ?? (() => installSignalHandlers());
  let server: { stop(): void } | undefined;
  // Tracks whether start() completed, so stop() is a clean no-op when the
  // daemon isn't running (double-stop / stop-before-start are both safe).
  let started = false;

  async function stop(): Promise<void> {
    if (!started) return; // idempotent: nothing to drain
    started = false;
    // Stop the PRODUCER first (D2): halt the scheduler/watcher/chain so no new
    // job is enqueued while the pool drains. Must precede pool.stop() — stop
    // producing before draining consumers.
    await opts.triggers?.stop();
    // Drain: stop claiming, await in-flight, interrupt stragglers (bounded by
    // drainTimeoutMs when set, else the pool's unbounded graceful drain).
    await opts.pool.stop(opts.drainTimeoutMs);
    server?.stop();
    server = undefined;
    clearPid(pidPath);
    recordDaemonStop({ pid: process.pid });
  }

  return {
    install(): void {
      opts.install?.();
    },
    async start(): Promise<void> {
      // 1. Double-start guard. readLivePid returns a pid only if the process it
      //    names is actually alive (and clears a stale file otherwise), so a
      //    crashed daemon's leftover pid never blocks a restart.
      const existing = readLivePid(pidPath);
      if (existing !== undefined) {
        throw new Error(`daemon already running (pid ${existing})`);
      }
      // 2. §7.3: reconcile orphaned Running rows BEFORE the pool can claim, in
      //    the store's own transaction, so no row is ever picked up mid-flight.
      //    A `durable` predicate (Task 41) re-queues checkpoint-resumable
      //    orphans (crew/workflow) so they auto-resume; without it every orphan
      //    is Interrupted.
      opts.queue.reconcileOrphans({ durable: opts.durable });
      // 3. Record this process as the running daemon.
      writePid(pidPath, process.pid);
      // 4. Only now may workers begin claiming.
      opts.pool.start();
      // 5. INJECTED MODE: hand startWebServer our already-reconciled, already-
      //    started queue so it does NOT construct or start a second pool on the
      //    same DB (§7.3 double-pool fix — Task 17). Exactly one pool exists.
      const handle = opts.startWebServer({
        queue: {
          jobStore: opts.queue,
          pool: opts.pool,
          concurrency: opts.concurrency,
        },
        // Forward the daemon-owned engine so the injected server surfaces it on
        // ServerDeps.triggers (the /api/triggers* routes resolve THIS instance);
        // startWebServer does NOT start/stop an injected engine — the daemon does
        // (step 5b below + stop-first above).
        triggers: opts.triggers,
      });
      server = handle.server;
      started = true;
      // 5b. Start the PRODUCER LAST — AFTER the pool is claiming and the server
      //     is up (D2). The engine only ENQUEUES (via the scheduler/watcher/chain
      //     fire), never executes, so a fire the instant it starts lands on an
      //     already-running consumer.
      opts.triggers?.start();
      // 6. SIGTERM/SIGINT → graceful drain via stop().
      onShutdown(() => stop());
      installSignals();
      recordDaemonStart({ pid: process.pid });
    },
    stop,
    status(): { running: boolean; pid?: number } {
      const pid = readLivePid(pidPath);
      return { running: pid !== undefined, pid };
    },
  };
}
