import { expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJobStore } from '../../src/queue/store.ts';
import { JobKind, JobStatus } from '../../src/queue/types.ts';

function tempStore() {
  return createJobStore({ path: mkdtempSync(join(tmpdir(), 'jobs-')) }, {});
}

test('reconcileOrphans marks every stuck Running job Interrupted, leaves others', () => {
  const store = tempStore();
  const a = store.enqueue({ kind: JobKind.Crew, payload: 1 });
  const b = store.enqueue({ kind: JobKind.Crew, payload: 2 });
  const c = store.enqueue({ kind: JobKind.Crew, payload: 3 });
  // NOTE: claimNext's created_at/id tiebreak is not insertion order (ids carry a
  // random suffix and same-ms enqueues tie on created_at), so we CAPTURE which
  // two jobs are actually claimed rather than assuming it claims a/b. This is
  // the fix for the brief's flaky verbatim test (see task-10-report.md).
  const c1 = store.claimNext(); // -> Running
  const c2 = store.claimNext(); // -> Running
  if (c1 === null || c2 === null) throw new Error('expected two claims');
  const claimedIds = new Set([c1.id, c2.id]);
  // The one job left Queued (never claimed) -> mark Done so it is a non-Running
  // row reconcile must leave untouched.
  const unclaimed = [a, b, c].find((j) => !claimedIds.has(j.id));
  if (unclaimed === undefined) throw new Error('expected one unclaimed job');
  store.markDone(unclaimed.id, null);

  const res = store.reconcileOrphans();
  expect(res.interrupted).toBe(2); // both Running orphans flipped
  expect(res.requeued).toBe(0); // Increment 2: no durable-requeue yet
  expect(store.getJob(c1.id)?.status).toBe(JobStatus.Interrupted);
  expect(store.getJob(c2.id)?.status).toBe(JobStatus.Interrupted);
  expect(store.getJob(unclaimed.id)?.status).toBe(JobStatus.Done); // untouched
  store.close();
});

test('reconcileOrphans is a no-op when nothing is Running', () => {
  const store = tempStore();
  store.enqueue({ kind: JobKind.Chat, payload: 1 });
  const res = store.reconcileOrphans();
  expect(res).toEqual({ interrupted: 0, requeued: 0 });
  store.close();
});

test('reconciled orphan carries finished_at and is not re-claimable', () => {
  const store = tempStore();
  const orphan = store.enqueue({ kind: JobKind.Crew, payload: 1 });
  store.claimNext(); // -> Running
  const res = store.reconcileOrphans();
  expect(res.interrupted).toBe(1);
  const rec = store.getJob(orphan.id);
  expect(rec?.status).toBe(JobStatus.Interrupted);
  expect(rec?.finishedAt).toBeGreaterThan(0); // finished_at stamped
  // No double-exec path: the interrupted job is no longer queued/running so a
  // starting pool's claimNext must not pick it up.
  expect(store.claimNext()).toBeNull();
  store.close();
});

test('reconcileOrphans leaves failed and canceled rows untouched', () => {
  const store = tempStore();
  const failed = store.enqueue({ kind: JobKind.Crew, payload: 1 });
  const canceled = store.enqueue({ kind: JobKind.Crew, payload: 2 });
  const alreadyInterrupted = store.enqueue({ kind: JobKind.Crew, payload: 3 });
  const running = store.enqueue({ kind: JobKind.Crew, payload: 4 });
  // Drive each into a distinct terminal/interrupted state (claimNext bumps to
  // Running first where a mark* needs it).
  store.claimNext();
  store.markFailed(failed.id, 'boom', false); // -> Failed (non-retryable)
  store.markCanceled(canceled.id); // -> Canceled
  store.markInterrupted(alreadyInterrupted.id); // -> Interrupted (pre-existing)
  store.claimNext(); // running -> Running (only remaining queued)
  const res = store.reconcileOrphans();
  expect(res.interrupted).toBe(1); // only the one live Running orphan
  expect(res.requeued).toBe(0);
  expect(store.getJob(failed.id)?.status).toBe(JobStatus.Failed);
  expect(store.getJob(canceled.id)?.status).toBe(JobStatus.Canceled);
  expect(store.getJob(alreadyInterrupted.id)?.status).toBe(
    JobStatus.Interrupted,
  );
  expect(store.getJob(running.id)?.status).toBe(JobStatus.Interrupted);
  store.close();
});
