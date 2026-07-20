/**
 * §7.2 — the poll-tick scheduler that drives cron triggers.
 *
 * Design: a single interval fires `tick()` every `pollMs`. Each tick atomically
 * claims the due cron rows (`triggerStore.claimDueCron` — one write-locked
 * transaction that selects due rows AND advances their `next_run_at` in one
 * critical section, so a row can never be double-claimed) and fires each one
 * fire-and-forget into `fire.ts` (which owns overlap/cap/provenance/audit).
 *
 * There are NO Croner-managed timers here — Croner is used purely to COMPUTE
 * the next occurrence (see next-run.ts). The clock and the interval are
 * injectable seams so tests drive fake time and a manual `tick()` — never real
 * sleeps.
 *
 * Misfire policy is AT-MOST-ONCE, "fire-once-on-boot": if a trigger's due time
 * passed while the daemon was down, `reconcile()` leaves the past `next_run_at`
 * in place so the FIRST tick claims it exactly once (then claimDueCron advances
 * it to the next FUTURE occurrence — never one fire per missed interval). A
 * per-trigger `catchUp:false` opts out and skips straight to the next future
 * occurrence. Do not describe this as "exactly once" — a crash between claim
 * and enqueue can drop the catch-up; the guarantee is at-most-once.
 */

import { createLogger } from '../log/logger.ts';
import type { FireTrigger } from './fire.ts';
import { computeNextRun } from './next-run.ts';
import type { TriggerStore } from './store.ts';
import { type CronConfig, type Trigger, TriggerType } from './types.ts';

const log = createLogger('triggers.scheduler');

export type Scheduler = {
  start(): void;
  stop(): void;
  tick(now?: number): void;
  reconcile(now?: number): void;
};

export function createScheduler(deps: {
  triggerStore: TriggerStore;
  fire: FireTrigger;
  pollMs: number;
  now?: () => number;
  setInterval?: typeof setInterval;
  clearInterval?: typeof clearInterval;
}): Scheduler {
  const clock = deps.now ?? ((): number => Date.now());
  const set = deps.setInterval ?? setInterval;
  const clear = deps.clearInterval ?? clearInterval;

  let interval: ReturnType<typeof setInterval> | undefined;
  // T7 liveness counters: surfaced in the structured logs so a wedged store or
  // a rejecting fire is diagnosable without killing the loop.
  let tickErrors = 0;
  let fireErrors = 0;

  /**
   * One poll pass. Claims the due cron rows and fires each fire-and-forget.
   *
   * T7 CARRY (liveness): an error out of `claimDueCron` — including a transient
   * SQLITE_BUSY past the busy_timeout, or the DB being closed mid-shutdown —
   * MUST NOT propagate. If it did, an uncaught exception in the interval
   * callback would tear down the scheduler (and, unhandled, the daemon). We
   * log+count and return; the interval stays armed, so the next tick retries.
   */
  function tick(now = clock()): void {
    let due: Trigger[];
    try {
      due = deps.triggerStore.claimDueCron(now, (t) => computeNextRun(t, now));
    } catch (err) {
      tickErrors += 1;
      log.error('scheduler tick claim failed — keeping the loop alive', {
        tickErrors,
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    for (const t of due) {
      // Fire-and-forget: fire.ts handles overlap/cap/provenance/audit and its
      // own errors internally, but a rejected promise here must never become an
      // unhandledRejection (which could crash the daemon) — so attach a .catch
      // that logs+counts. `void` documents the intentional non-await.
      void deps.fire(t, { reason: 'cron' }).catch((err: unknown) => {
        fireErrors += 1;
        log.error('scheduler fire rejected', {
          triggerId: t.id,
          fireErrors,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }
  }

  /**
   * Boot reconciliation over every cron trigger. Runs BEFORE the first interval
   * tick (see `start`) so a missed occurrence is caught up on the very first
   * tick rather than a poll interval later.
   */
  function reconcile(now = clock()): void {
    for (const t of deps.triggerStore.list()) {
      if (t.type !== TriggerType.Cron) continue;
      const next = computeNextRun(t, now);
      if (next == null) {
        // I1: an unparseable pattern / bad zone must never throw out of
        // reconcile and must never loop a tick. Disable the row and move on —
        // the daemon boot survives a bad repo cron. (`update` on an
        // already-disabled row is idempotent.)
        deps.triggerStore.update(t.id, { enabled: false });
        log.warn('disabled trigger with an uncomputable cron', {
          triggerId: t.id,
        });
        continue;
      }
      if (t.nextRunAt == null) {
        // Fresh trigger (never scheduled) — seed its next fire time.
        deps.triggerStore.update(t.id, { nextRunAt: next });
      } else if (t.nextRunAt < now) {
        // Its due time passed while the daemon was down (a "misfire").
        if ((t.config as CronConfig).catchUp === false) {
          // catchUp:false → skip the missed occurrence, advance to the future.
          deps.triggerStore.update(t.id, { nextRunAt: next });
        }
        // else: LEAVE the past next_run_at in place. The first `tick` claims it
        // once (one catch-up fire), then claimDueCron advances it to the next
        // FUTURE occurrence — at-most-once, never one fire per missed interval.
      }
      // else (next_run_at in the future): nothing to do.
    }
  }

  return {
    start(): void {
      // reconcile FIRST so the boot catch-up is decided before any tick claims.
      reconcile();
      interval = set(() => tick(), deps.pollMs);
    },
    stop(): void {
      if (interval !== undefined) {
        clear(interval);
        interval = undefined;
      }
    },
    tick,
    reconcile,
  };
}
