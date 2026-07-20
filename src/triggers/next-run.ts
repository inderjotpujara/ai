/**
 * Croner-backed next-occurrence computation for cron triggers (Slice 25).
 *
 * Croner is used as a LIBRARY only — `new Cron(pattern, { timezone })` +
 * `.nextRun(after)`. No Croner-managed timers exist anywhere; the scheduler
 * owns the poll loop (see scheduler.ts) and calls these pure helpers to derive
 * the next fire time. Croner (not a hand-rolled parser) is what gives us
 * correct IANA-timezone / DST handling.
 */

import { Cron } from 'croner';
import type { CronConfig, Trigger } from './types.ts';

/**
 * True if `schedule` is a parseable cron pattern. Construction-only — a bad
 * IANA zone is NOT rejected here (Croner only fails a bad zone when it computes
 * a date), so this validates the PATTERN. A bad zone still degrades safely
 * because `computeNextRun` returns null on the `.nextRun()` throw.
 */
export function validateCron(schedule: string, timezone?: string): boolean {
  try {
    new Cron(schedule, { timezone });
    return true;
  } catch {
    return false;
  }
}

/**
 * The next fire time strictly after `after` (epoch ms), or `null` if the
 * pattern/timezone cannot produce one.
 *
 * MUST NOT throw: an invalid repo/console cron must never crash the boot
 * reconcile or a poll tick. Both failure modes are wrapped —
 *   - a malformed PATTERN throws at `new Cron(...)`, and
 *   - a bad TIMEZONE throws later at `.nextRun(...)` —
 * so the whole expression is inside one try/catch. A null result parks the row
 * (claimDueCron nulls next_run_at; reconcile disables the trigger) rather than
 * looping a tick or killing the daemon.
 */
export function computeNextRun(t: Trigger, after: number): number | null {
  const cfg = t.config as CronConfig;
  try {
    return (
      new Cron(cfg.schedule, { timezone: cfg.timezone })
        .nextRun(new Date(after))
        ?.getTime() ?? null
    );
  } catch {
    return null;
  }
}
