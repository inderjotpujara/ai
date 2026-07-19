import { expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJobStore } from '../../src/queue/store.ts';
import { JobKind, JobPriority, JobStatus } from '../../src/queue/types.ts';

function tempStore() {
  const dir = mkdtempSync(join(tmpdir(), 'jobs-'));
  return createJobStore({ path: dir }, {});
}

test('enqueue returns a Queued JobRecord with defaults applied', () => {
  const store = tempStore();
  const job = store.enqueue({
    kind: JobKind.Crew,
    payload: { name: 'x', input: 'go' },
  });
  expect(job.status).toBe(JobStatus.Queued);
  expect(job.priority).toBe(JobPriority.Normal);
  expect(job.attempts).toBe(0);
  expect(job.maxAttempts).toBeGreaterThan(0);
  expect(job.id).toMatch(/^job-/);
  expect(job.runId).toMatch(/^run-/); // store mints a runId when caller omits it
  expect(job.startedAt).toBeUndefined();
  store.close();
});

test('enqueue honours an explicit priority + caller-minted runId', () => {
  const store = tempStore();
  const job = store.enqueue({
    kind: JobKind.Chat,
    payload: { task: 'hi' },
    priority: JobPriority.High,
    runId: 'run-fixed-123',
  });
  expect(job.priority).toBe(JobPriority.High);
  expect(job.runId).toBe('run-fixed-123');
  store.close();
});

test('enqueue defaults availableAt to 0 and preserves an explicit availableAt', () => {
  const store = tempStore();
  // Default: immediately claimable.
  const def = store.enqueue({ kind: JobKind.Chat, payload: 'now' });
  expect(def.availableAt).toBe(0);
  expect(store.getJob(def.id)?.availableAt).toBe(0);
  // Explicit floor survives enqueue -> getJob (Task 8 retry backoff depends on this).
  const at = Date.now() + 60_000;
  const later = store.enqueue({
    kind: JobKind.Chat,
    payload: 'later',
    availableAt: at,
  });
  expect(later.availableAt).toBe(at);
  expect(store.getJob(later.id)?.availableAt).toBe(at);
  store.close();
});

test('getJob round-trips payload JSON and returns undefined for a missing id', () => {
  const store = tempStore();
  const job = store.enqueue({
    kind: JobKind.Workflow,
    payload: { def: 'wf', input: 'q' },
  });
  const got = store.getJob(job.id);
  expect(got?.payload).toEqual({ def: 'wf', input: 'q' });
  expect(store.getJob('job-nope')).toBeUndefined();
  store.close();
});
