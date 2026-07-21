import { expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  JobKind,
  JobPriority,
  type JobRecord,
  JobStatus,
} from '../../src/queue/types.ts';
import { createChainObserver } from '../../src/triggers/chain.ts';
import type { FireContext, FireTrigger } from '../../src/triggers/fire.ts';
import { createTriggerStore } from '../../src/triggers/store.ts';
import {
  type JobChainConfig,
  type Trigger,
  TriggerOrigin,
  TriggerType,
} from '../../src/triggers/types.ts';

function tempTriggerStore() {
  return createTriggerStore({ path: mkdtempSync(join(tmpdir(), 'trig-')) });
}

function jobRecord(over: Partial<JobRecord> = {}): JobRecord {
  return {
    id: 'job-A',
    kind: JobKind.Crew,
    payload: {},
    priority: JobPriority.Normal,
    status: JobStatus.Done,
    attempts: 1,
    maxAttempts: 1,
    createdAt: 0,
    updatedAt: 0,
    startedAt: undefined,
    finishedAt: undefined,
    availableAt: 0,
    runId: undefined,
    result: undefined,
    error: undefined,
    retriedFrom: null,
    origin: undefined,
    chainDepth: 0,
    ...over,
  };
}

function spyFire() {
  const calls: Array<{ trigger: Trigger; ctx: FireContext }> = [];
  const fire: FireTrigger = async (trigger, ctx) => {
    calls.push({ trigger, ctx });
    return { fired: true, jobId: 'job-B', runId: 'run-B' };
  };
  return { calls, fire };
}

function makeChainTrigger(
  store: ReturnType<typeof tempTriggerStore>,
  config: JobChainConfig,
  enabled = true,
): Trigger {
  return store.create({
    name: `chain-${Math.random().toString(36).slice(2)}`,
    type: TriggerType.JobChain,
    enabled,
    target: { kind: JobKind.Chat, payload: { task: 'downstream' } },
    config,
    origin: TriggerOrigin.Repo,
  });
}

test('a matching completion fires the chained trigger with depth+1', () => {
  const store = tempTriggerStore();
  makeChainTrigger(store, { onKind: JobKind.Crew, onStatus: JobStatus.Done });
  const { calls, fire } = spyFire();
  const observer = createChainObserver({
    triggerStore: store,
    fire,
    maxChainDepth: () => 8,
  });

  observer.handleJobSettled(
    jobRecord({ id: 'job-A', chainDepth: 0, runId: 'run-A' }),
    JobStatus.Done,
  );

  expect(calls).toHaveLength(1);
  expect(calls[0]?.ctx.reason).toBe('chain');
  expect(calls[0]?.ctx.chainDepth).toBe(1);
  expect(calls[0]?.ctx.vars).toEqual({
    'chain.jobId': 'job-A',
    'chain.runId': 'run-A',
  });
  store.close();
});

test('depth threading passes the incremented depth to fire (cap enforced downstream)', () => {
  const store = tempTriggerStore();
  makeChainTrigger(store, { onStatus: JobStatus.Done });
  const { calls, fire } = spyFire();
  const max = 5;
  const observer = createChainObserver({
    triggerStore: store,
    fire,
    maxChainDepth: () => max,
  });

  // The finished job is already at the cap; the observer still increments and
  // delegates — fire.ts (Task 9) is the one place that enforces the cap.
  observer.handleJobSettled(jobRecord({ chainDepth: max }), JobStatus.Done);

  expect(calls).toHaveLength(1);
  expect(calls[0]?.ctx.chainDepth).toBe(max + 1);
  store.close();
});

test('a completion whose status does not match onStatus does not fire', () => {
  const store = tempTriggerStore();
  makeChainTrigger(store, { onStatus: JobStatus.Failed });
  const { calls, fire } = spyFire();
  const observer = createChainObserver({
    triggerStore: store,
    fire,
    maxChainDepth: () => 8,
  });

  observer.handleJobSettled(jobRecord(), JobStatus.Done);

  expect(calls).toHaveLength(0);
  store.close();
});

test('onKind narrows: a different-kind completion does not fire', () => {
  const store = tempTriggerStore();
  makeChainTrigger(store, {
    onKind: JobKind.Workflow,
    onStatus: JobStatus.Done,
  });
  const { calls, fire } = spyFire();
  const observer = createChainObserver({
    triggerStore: store,
    fire,
    maxChainDepth: () => 8,
  });

  observer.handleJobSettled(jobRecord({ kind: JobKind.Crew }), JobStatus.Done);

  expect(calls).toHaveLength(0);
  store.close();
});

test('onName matches the finished job payload name (and mismatches do not fire)', () => {
  const store = tempTriggerStore();
  makeChainTrigger(store, { onName: 'nightly', onStatus: JobStatus.Done });
  const { calls, fire } = spyFire();
  const observer = createChainObserver({
    triggerStore: store,
    fire,
    maxChainDepth: () => 8,
  });

  observer.handleJobSettled(
    jobRecord({ payload: { name: 'other', input: '' } }),
    JobStatus.Done,
  );
  expect(calls).toHaveLength(0);

  observer.handleJobSettled(
    jobRecord({ payload: { name: 'nightly', input: '' } }),
    JobStatus.Done,
  );
  expect(calls).toHaveLength(1);
  store.close();
});

test('a disabled jobchain trigger is not fired', () => {
  const store = tempTriggerStore();
  makeChainTrigger(store, { onStatus: JobStatus.Done }, false);
  const { calls, fire } = spyFire();
  const observer = createChainObserver({
    triggerStore: store,
    fire,
    maxChainDepth: () => 8,
  });

  observer.handleJobSettled(jobRecord(), JobStatus.Done);

  expect(calls).toHaveLength(0);
  store.close();
});
