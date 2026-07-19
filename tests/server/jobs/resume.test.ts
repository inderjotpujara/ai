import { expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJobStore } from '../../../src/queue/store.ts';
import { JobKind, JobStatus } from '../../../src/queue/types.ts';

function tempStore() {
  return createJobStore({ path: mkdtempSync(join(tmpdir(), 'jobs-')) }, {});
}

test('reconcileOrphans requeues durable orphans and interrupts the rest', () => {
  const store = tempStore();
  const crew = store.enqueue({ kind: JobKind.Crew, payload: 1 });
  const chat = store.enqueue({ kind: JobKind.Chat, payload: 2 });
  store.claimNext(); // crew -> Running (oldest)
  store.claimNext(); // chat -> Running
  const res = store.reconcileOrphans({
    durable: (j) => j.kind === JobKind.Crew || j.kind === JobKind.Workflow,
  });
  expect(res.requeued).toBe(1);
  expect(res.interrupted).toBe(1);
  expect(store.getJob(crew.id)?.status).toBe(JobStatus.Queued); // resumable → re-claimed
  expect(store.getJob(crew.id)?.availableAt).toBe(0); // immediately claimable at boot
  expect(store.getJob(chat.id)?.status).toBe(JobStatus.Interrupted);
  store.close();
});

test('reconcileOrphans with no predicate still interrupts all (Inc-2 behaviour preserved)', () => {
  const store = tempStore();
  const crew = store.enqueue({ kind: JobKind.Crew, payload: 1 });
  store.claimNext();
  expect(store.reconcileOrphans()).toEqual({ interrupted: 1, requeued: 0 });
  expect(store.getJob(crew.id)?.status).toBe(JobStatus.Interrupted);
  store.close();
});
