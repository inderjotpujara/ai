import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JobKind } from '../../src/queue/types.ts';
import type { FireResult, FireTrigger } from '../../src/triggers/fire.ts';
import { createScheduler } from '../../src/triggers/scheduler.ts';
import { createTriggerStore } from '../../src/triggers/store.ts';
import {
  type CronConfig,
  type Trigger,
  TriggerOrigin,
  TriggerOutcome,
  TriggerType,
} from '../../src/triggers/types.ts';

const NOW = Date.parse('2026-03-08T12:00:00Z');

function harness() {
  const dbDir = mkdtempSync(join(tmpdir(), 'sched-db-'));
  const store = createTriggerStore({ path: dbDir });
  const fired: Trigger[] = [];
  const fire: FireTrigger = async (t): Promise<FireResult> => {
    fired.push(t);
    return { fired: true, jobId: 'j', runId: 'r' };
  };
  return { store, fired, fire };
}

const makeCron = (
  store: ReturnType<typeof createTriggerStore>,
  opts: { nextRunAt?: number; config?: Partial<CronConfig> } = {},
): Trigger =>
  store.create({
    name: `t-${Math.random()}`,
    type: TriggerType.Cron,
    origin: TriggerOrigin.Console,
    target: { kind: JobKind.Chat, payload: {} },
    config: { schedule: '* * * * *', ...opts.config },
    nextRunAt: opts.nextRunAt,
  });

let stores: ReturnType<typeof createTriggerStore>[] = [];
beforeEach(() => {
  stores = [];
});
afterEach(() => {
  for (const s of stores) s.close();
});
function track(s: ReturnType<typeof createTriggerStore>) {
  stores.push(s);
  return s;
}

test('tick fires a due cron at-most-once per due time', () => {
  const { store, fired, fire } = harness();
  track(store);
  makeCron(store, { nextRunAt: NOW - 1000 });
  const sched = createScheduler({
    triggerStore: store,
    fire,
    pollMs: 1000,
    now: () => NOW,
  });

  sched.tick(NOW);
  expect(fired.length).toBe(1);
  // Second tick at the same instant: claimDueCron already advanced next_run_at
  // to the next future occurrence, so it is no longer due — no second fire.
  sched.tick(NOW);
  expect(fired.length).toBe(1);
});

test('reconcile leaves a missed catchUp trigger due for exactly one boot fire', () => {
  const { store, fired, fire } = harness();
  track(store);
  const t = makeCron(store, { nextRunAt: NOW - 5 * 60_000 });
  const sched = createScheduler({
    triggerStore: store,
    fire,
    pollMs: 1000,
    now: () => NOW,
  });

  // Default catchUp (undefined ≠ false) → the missed occurrence is LEFT due.
  sched.reconcile(NOW);
  expect(store.get(t.id)?.nextRunAt).toBe(NOW - 5 * 60_000);

  // First tick catches it up ONCE, then advances to the future.
  sched.tick(NOW);
  expect(fired.length).toBe(1);
  expect(store.get(t.id)?.nextRunAt).toBeGreaterThan(NOW);

  // No fire-per-missed-interval: a second tick at the same instant is a no-op.
  sched.tick(NOW);
  expect(fired.length).toBe(1);
});

test('reconcile with catchUp:false skips the missed fire', () => {
  const { store, fired, fire } = harness();
  track(store);
  const t = makeCron(store, {
    nextRunAt: NOW - 5 * 60_000,
    config: { catchUp: false },
  });
  const sched = createScheduler({
    triggerStore: store,
    fire,
    pollMs: 1000,
    now: () => NOW,
  });

  sched.reconcile(NOW);
  // Advanced straight to the next future occurrence, no catch-up left.
  expect(store.get(t.id)?.nextRunAt).toBeGreaterThan(NOW);

  sched.tick(NOW);
  expect(fired.length).toBe(0);
});

test('reconcile computes next_run_at for a fresh trigger with none set', () => {
  const { store, fire } = harness();
  track(store);
  const t = makeCron(store); // nextRunAt undefined
  const sched = createScheduler({
    triggerStore: store,
    fire,
    pollMs: 1000,
    now: () => NOW,
  });

  sched.reconcile(NOW);
  expect(store.get(t.id)?.nextRunAt).toBeGreaterThan(NOW);
});

test('reconcile leaves a future trigger untouched', () => {
  const { store, fired, fire } = harness();
  track(store);
  const future = NOW + 10 * 60_000;
  const t = makeCron(store, { nextRunAt: future });
  const sched = createScheduler({
    triggerStore: store,
    fire,
    pollMs: 1000,
    now: () => NOW,
  });

  sched.reconcile(NOW);
  expect(store.get(t.id)?.nextRunAt).toBe(future);
  sched.tick(NOW);
  expect(fired.length).toBe(0);
});

test('reconcile disables (never throws on) a trigger whose cron is unparseable', () => {
  const { store, fire } = harness();
  track(store);
  const t = makeCron(store, { config: { schedule: 'not a cron' } });
  const sched = createScheduler({
    triggerStore: store,
    fire,
    pollMs: 1000,
    now: () => NOW,
  });

  expect(() => sched.reconcile(NOW)).not.toThrow();
  expect(store.get(t.id)?.enabled).toBe(false);
});

test('a claimDueCron throw is caught — the scheduler keeps ticking (T7 liveness)', () => {
  const { store, fired, fire } = harness();
  track(store);
  makeCron(store, { nextRunAt: NOW - 1000 });

  let throwOnce = true;
  const flaky = {
    ...store,
    claimDueCron: (
      now: number,
      computeNext: (t: Trigger) => number | null,
    ): Trigger[] => {
      if (throwOnce) {
        throwOnce = false;
        throw new Error('SQLITE_BUSY: database is locked');
      }
      return store.claimDueCron(now, computeNext);
    },
  } as ReturnType<typeof createTriggerStore>;

  const sched = createScheduler({
    triggerStore: flaky,
    fire,
    pollMs: 1000,
    now: () => NOW,
  });

  // First tick: claim throws → caught, no crash, nothing fired.
  expect(() => sched.tick(NOW)).not.toThrow();
  expect(fired.length).toBe(0);
  // Scheduler keeps ticking: the next tick claims normally and fires.
  sched.tick(NOW);
  expect(fired.length).toBe(1);
});

test('start() reconciles before the first interval tick, stop() clears it', () => {
  const { store, fired, fire } = harness();
  track(store);
  // Missed occurrence with default catchUp → must be caught up on boot.
  makeCron(store, { nextRunAt: NOW - 5 * 60_000 });

  let intervalCb: (() => void) | undefined;
  let cleared = false;
  const fakeSetInterval = ((cb: () => void) => {
    intervalCb = cb;
    return 42 as unknown as ReturnType<typeof setInterval>;
  }) as typeof setInterval;
  const fakeClearInterval = ((_id: unknown) => {
    cleared = true;
  }) as typeof clearInterval;

  const sched = createScheduler({
    triggerStore: store,
    fire,
    pollMs: 1000,
    now: () => NOW,
    setInterval: fakeSetInterval,
    clearInterval: fakeClearInterval,
  });

  sched.start();
  // reconcile ran at start (left the missed row due); no tick yet.
  expect(fired.length).toBe(0);
  expect(intervalCb).toBeDefined();

  // The interval callback drives one tick → the caught-up fire happens.
  intervalCb?.();
  expect(fired.length).toBe(1);

  sched.stop();
  expect(cleared).toBe(true);
});

// Provenance/outcome enum import keeps the reason string in sync with fire.ts.
test('the outcome enum is available for reason mapping sanity', () => {
  expect(TriggerOutcome.Fired).toBe('fired' as TriggerOutcome);
});
