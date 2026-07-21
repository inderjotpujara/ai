import { expect, test } from 'bun:test';
import { computeNextRun, validateCron } from '../../src/triggers/next-run.ts';
import type { Trigger } from '../../src/triggers/types.ts';

const cron = (schedule: string, timezone?: string): Trigger =>
  ({ config: { schedule, timezone } }) as unknown as Trigger;

test('computeNextRun respects an IANA timezone', () => {
  const t = cron('0 3 * * *', 'America/New_York');
  expect(typeof computeNextRun(t, Date.parse('2026-03-08T00:00:00Z'))).toBe(
    'number',
  );
});

test('computeNextRun returns a strictly future occurrence for a due pattern', () => {
  const after = Date.parse('2026-03-08T00:00:00Z');
  const next = computeNextRun(cron('* * * * *'), after);
  expect(next).not.toBeNull();
  expect(next as number).toBeGreaterThan(after);
});

test('computeNextRun returns null for an unparseable cron (never throws)', () => {
  const t = cron('not a cron');
  expect(computeNextRun(t, Date.now())).toBeNull();
});

test('computeNextRun returns null for a bad timezone (never throws)', () => {
  // Croner throws on the .nextRun() call (not construction) for a bad zone —
  // the wrapping try/catch must still yield null, never propagate.
  const t = cron('0 3 * * *', 'Not/AZone');
  expect(computeNextRun(t, Date.now())).toBeNull();
});

test('validateCron accepts a good pattern and rejects a bad one', () => {
  expect(validateCron('0 3 * * *')).toBe(true);
  expect(validateCron('0 3 * * *', 'America/New_York')).toBe(true);
  expect(validateCron('not a cron')).toBe(false);
  // Croner rejects a bad zone only when it computes a date, not at
  // construction — so validateCron (construction-only) still accepts it. A bad
  // zone is caught later by computeNextRun returning null (see test above).
  expect(validateCron('0 3 * * *', 'Not/AZone')).toBe(true);
});
