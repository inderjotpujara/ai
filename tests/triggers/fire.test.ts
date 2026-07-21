import { expect, test } from 'bun:test';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunOrigin } from '../../src/contracts/enums.ts';
import { createJobStore } from '../../src/queue/store.ts';
import { JobKind } from '../../src/queue/types.ts';
import { createFireTrigger } from '../../src/triggers/fire.ts';
import { createTriggerStore } from '../../src/triggers/store.ts';
import {
  type Trigger,
  TriggerOrigin,
  TriggerOutcome,
  TriggerType,
} from '../../src/triggers/types.ts';

function harness(maxDepth = 5) {
  const dbDir = mkdtempSync(join(tmpdir(), 'fire-db-'));
  const runsRoot = mkdtempSync(join(tmpdir(), 'fire-runs-'));
  // TriggerStore first: it runs the JOBS_DB_MIGRATIONS superset (creates BOTH
  // the jobs and triggers tables). The JobStore then opens the same jobs.db.
  const triggerStore = createTriggerStore({ path: dbDir });
  const jobStore = createJobStore({ path: dbDir }, {});
  const fire = createFireTrigger({
    triggerStore,
    jobStore,
    runsRoot,
    maxChainDepth: () => maxDepth,
  });
  return { triggerStore, jobStore, fire, runsRoot };
}

const cronTrigger = (
  triggerStore: ReturnType<typeof createTriggerStore>,
  opts: { allowOverlap?: boolean } = {},
): Trigger =>
  triggerStore.create({
    name: `t-${Math.random()}`,
    type: TriggerType.Cron,
    origin: TriggerOrigin.Console,
    target: { kind: JobKind.Chat, payload: { task: 'process {{file.path}}' } },
    config: { schedule: '* * * * *', allowOverlap: opts.allowOverlap },
    nextRunAt: 100,
    enabled: true,
  });

test('cron fire enqueues origin=schedule + records a Fired firing', async () => {
  const { triggerStore, jobStore, fire, runsRoot } = harness();
  const t = cronTrigger(triggerStore);
  const res = await fire(t, { reason: 'cron', vars: { 'file.path': '/d/x' } });
  expect(res.fired).toBe(true);
  if (!res.fired) throw new Error('expected fired');
  const job = jobStore.getJob(res.jobId);
  expect(job?.origin).toBe(RunOrigin.Schedule);
  expect(job?.chainDepth).toBe(0);
  // Template substitution ran on the payload.
  expect((job?.payload as { task: string }).task).toBe('process /d/x');
  // Pre-created run dir so an immediate stream never 404s.
  expect(existsSync(join(runsRoot, res.runId))).toBe(true);
  // Firing recorded as Fired, and last_fired_at bumped.
  const last = triggerStore.latestFiring(t.id);
  expect(last?.outcome).toBe(TriggerOutcome.Fired);
  expect(last?.jobId).toBe(res.jobId);
  expect(triggerStore.get(t.id)?.lastFiredAt).toBeDefined();
  triggerStore.close();
  jobStore.close();
});

test('overlap skip when the previous job is still running', async () => {
  const { triggerStore, jobStore, fire } = harness();
  const t = cronTrigger(triggerStore);
  const first = await fire(t, { reason: 'cron' });
  expect(first.fired).toBe(true);
  // The previous job is still Queued (in-flight) → second fire skips.
  const second = await fire(t, { reason: 'cron' });
  expect(second.fired).toBe(false);
  if (second.fired) throw new Error('expected skip');
  expect(second.outcome).toBe(TriggerOutcome.SkippedOverlap);
  // The skip still writes an audit firing row.
  expect(triggerStore.latestFiring(t.id)?.outcome).toBe(
    TriggerOutcome.SkippedOverlap,
  );
  triggerStore.close();
  jobStore.close();
});

test('overlap allowed by config lets a concurrent fire through', async () => {
  const { triggerStore, jobStore, fire } = harness();
  const t = cronTrigger(triggerStore, { allowOverlap: true });
  await fire(t, { reason: 'cron' });
  const second = await fire(t, { reason: 'cron' });
  expect(second.fired).toBe(true);
  triggerStore.close();
  jobStore.close();
});

test('overlap does not block once the previous job is terminal', async () => {
  const { triggerStore, jobStore, fire } = harness();
  const t = cronTrigger(triggerStore);
  const first = await fire(t, { reason: 'cron' });
  if (!first.fired) throw new Error('expected fired');
  jobStore.markDone(first.jobId, {}); // previous job is Done → no overlap
  const second = await fire(t, { reason: 'cron' });
  expect(second.fired).toBe(true);
  triggerStore.close();
  jobStore.close();
});

test('chain-depth cap halts a runaway chain (recorded skip, no enqueue)', async () => {
  const { triggerStore, jobStore, fire } = harness(3);
  const t = cronTrigger(triggerStore);
  const before = jobStore.stats().total;
  const res = await fire(t, { reason: 'chain', chainDepth: 4 });
  expect(res.fired).toBe(false);
  if (res.fired) throw new Error('expected fail');
  expect(res.outcome).toBe(TriggerOutcome.Failed);
  // No job enqueued.
  expect(jobStore.stats().total).toBe(before);
  // The failure is recorded as an audit firing.
  expect(triggerStore.latestFiring(t.id)?.outcome).toBe(TriggerOutcome.Failed);
  triggerStore.close();
  jobStore.close();
});

test('a chain fire at the cap boundary still enqueues with its chainDepth', async () => {
  const { triggerStore, jobStore, fire } = harness(3);
  const t = cronTrigger(triggerStore);
  const res = await fire(t, { reason: 'chain', chainDepth: 3 });
  expect(res.fired).toBe(true);
  if (!res.fired) throw new Error('expected fired');
  expect(jobStore.getJob(res.jobId)?.chainDepth).toBe(3);
  expect(jobStore.getJob(res.jobId)?.origin).toBe(RunOrigin.Api);
  triggerStore.close();
  jobStore.close();
});

test('bypassOverlap (manual test-fire) ignores an in-flight previous job', async () => {
  const { triggerStore, jobStore, fire } = harness();
  const t = cronTrigger(triggerStore);
  await fire(t, { reason: 'cron' }); // leaves a Queued job in flight
  const manual = await fire(t, { reason: 'manual', bypassOverlap: true });
  expect(manual.fired).toBe(true);
  expect(jobStore.getJob((manual as { jobId: string }).jobId)?.origin).toBe(
    RunOrigin.Api,
  );
  triggerStore.close();
  jobStore.close();
});

test('overlap guard: a skip row does not mask the still-in-flight fired job (3-fire regression)', async () => {
  const { triggerStore, jobStore, fire } = harness();
  const t = cronTrigger(triggerStore); // every-tick cron, no allowOverlap
  // fire1: job A enqueued and Fired.
  const fire1 = await fire(t, { reason: 'cron' });
  expect(fire1.fired).toBe(true);
  // Job A goes Queued → Running and stays in flight.
  jobStore.claimNext();
  // fire2: A still Running → SkippedOverlap (writes a jobId-null skip row).
  const fire2 = await fire(t, { reason: 'cron' });
  expect(fire2.fired).toBe(false);
  if (fire2.fired) throw new Error('expected skip');
  expect(fire2.outcome).toBe(TriggerOutcome.SkippedOverlap);
  // fire3: the MOST-RECENT firing is now fire2's skip row (jobId=null). With
  // latestFiring the guard would fall through and BREACH (concurrent enqueue);
  // latestFiredFiring still sees job A Running → must ALSO SkippedOverlap.
  const fire3 = await fire(t, { reason: 'cron' });
  expect(fire3.fired).toBe(false);
  if (fire3.fired) throw new Error('expected skip');
  expect(fire3.outcome).toBe(TriggerOutcome.SkippedOverlap);
  triggerStore.close();
  jobStore.close();
});

test('two concurrent fires on a non-allowOverlap trigger yield exactly one Fired + one SkippedOverlap', async () => {
  const { triggerStore, jobStore, fire } = harness();
  const t = cronTrigger(triggerStore);
  // Concurrent webhook-style deliveries. Under the F2 reorder the
  // check→enqueue→record→update span no longer yields, so this is deterministic.
  const [a, b] = await Promise.all([
    fire(t, { reason: 'webhook' }),
    fire(t, { reason: 'webhook' }),
  ]);
  const outcomes = [a, b]
    .map((r) => (r.fired ? TriggerOutcome.Fired : r.outcome))
    .sort();
  expect(outcomes).toEqual(
    [TriggerOutcome.Fired, TriggerOutcome.SkippedOverlap].sort(),
  );
  // Exactly one job was enqueued.
  expect(jobStore.stats().total).toBe(1);
  triggerStore.close();
  jobStore.close();
});

test('chainDepth clamp: NaN is rejected as cap-exceeded (no enqueue)', async () => {
  const { triggerStore, jobStore, fire } = harness();
  const t = cronTrigger(triggerStore);
  const before = jobStore.stats().total;
  const res = await fire(t, { reason: 'chain', chainDepth: Number.NaN });
  expect(res.fired).toBe(false);
  if (res.fired) throw new Error('expected fail');
  expect(res.outcome).toBe(TriggerOutcome.Failed);
  expect(jobStore.stats().total).toBe(before);
  expect(triggerStore.latestFiring(t.id)?.outcome).toBe(TriggerOutcome.Failed);
  triggerStore.close();
  jobStore.close();
});

test('chainDepth clamp: a negative depth is rejected as cap-exceeded (no enqueue)', async () => {
  const { triggerStore, jobStore, fire } = harness();
  const t = cronTrigger(triggerStore);
  const before = jobStore.stats().total;
  const res = await fire(t, { reason: 'chain', chainDepth: -5 });
  expect(res.fired).toBe(false);
  if (res.fired) throw new Error('expected fail');
  expect(res.outcome).toBe(TriggerOutcome.Failed);
  expect(jobStore.stats().total).toBe(before);
  triggerStore.close();
  jobStore.close();
});

test('webhook fire maps to origin=webhook', async () => {
  const { triggerStore, jobStore, fire } = harness();
  const t = triggerStore.create({
    name: `wh-${Math.random()}`,
    type: TriggerType.Webhook,
    origin: TriggerOrigin.Console,
    target: { kind: JobKind.Chat, payload: { task: 'go' } },
    config: {},
    enabled: true,
  });
  const res = await fire(t, { reason: 'webhook' });
  if (!res.fired) throw new Error('expected fired');
  expect(jobStore.getJob(res.jobId)?.origin).toBe(RunOrigin.Webhook);
  triggerStore.close();
  jobStore.close();
});
