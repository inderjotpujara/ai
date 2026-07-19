import { expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJobStore } from '../../src/queue/store.ts';
import { JobKind, JobPriority, JobStatus } from '../../src/queue/types.ts';

function tempStore() {
  return createJobStore({ path: mkdtempSync(join(tmpdir(), 'jobs-')) }, {});
}

// Documents the INTENT the claim scan relies on: High is ordered before Normal.
// The store's `priority ASC` scan works because these enum TEXT values sort
// High-before-Normal lexically; asserting it here (and guarding it in the store)
// means a future rename that broke scheduling fails loudly, not silently.
test('JobPriority enum orders High before Normal', () => {
  expect(JobPriority.High < JobPriority.Normal).toBe(true);
});

test('claimNext returns High-priority before Normal, then FIFO by createdAt', async () => {
  const store = tempStore();
  const n1 = store.enqueue({ kind: JobKind.Crew, payload: 1 });
  await Bun.sleep(2);
  const n2 = store.enqueue({ kind: JobKind.Crew, payload: 2 });
  await Bun.sleep(2);
  const h1 = store.enqueue({
    kind: JobKind.Crew,
    payload: 3,
    priority: JobPriority.High,
  });
  // High first, then Normals oldest-first.
  expect(store.claimNext()?.id).toBe(h1.id);
  expect(store.claimNext()?.id).toBe(n1.id);
  expect(store.claimNext()?.id).toBe(n2.id);
  expect(store.claimNext()).toBeNull();
  store.close();
});

test('claimNext flips the row to Running, sets started_at, bumps attempts', () => {
  const store = tempStore();
  const job = store.enqueue({ kind: JobKind.Chat, payload: 'x' });
  const claimed = store.claimNext();
  expect(claimed?.status).toBe(JobStatus.Running);
  expect(claimed?.attempts).toBe(1);
  expect(claimed?.startedAt).toBeGreaterThan(0);
  // Persisted, not just returned:
  expect(store.getJob(job.id)?.status).toBe(JobStatus.Running);
  store.close();
});

test('a claimed row is never re-claimed (no double-claim)', () => {
  const store = tempStore();
  const enqueued = store.enqueue({ kind: JobKind.Chat, payload: 'x' });
  const first = store.claimNext();
  const second = store.claimNext();
  expect(first).not.toBeNull();
  expect(second).toBeNull(); // the only Queued row is gone
  // The one claim is the row we enqueued — never the same row twice.
  expect(first?.id).toBe(enqueued.id);
  store.close();
});

test('two sequential claims return two DIFFERENT job ids, never the same row twice', () => {
  const store = tempStore();
  store.enqueue({ kind: JobKind.Chat, payload: 'a' });
  store.enqueue({ kind: JobKind.Chat, payload: 'b' });
  const a = store.claimNext();
  const b = store.claimNext();
  expect(a?.id).toBeDefined();
  expect(b?.id).toBeDefined();
  expect(a?.id).not.toBe(b?.id);
  store.close();
});

test('a job with a future available_at is not claimed until it matures', () => {
  const store = tempStore();
  // Enqueued FIRST (older created_at) but scheduled into the future.
  store.enqueue({
    kind: JobKind.Chat,
    payload: 'later',
    availableAt: Date.now() + 60_000,
  });
  // Enqueued SECOND but already claimable.
  const ready = store.enqueue({
    kind: JobKind.Chat,
    payload: 'now',
    availableAt: Date.now() - 1_000,
  });
  // Despite being older, the future job is skipped; the matured one is claimed.
  expect(store.claimNext()?.id).toBe(ready.id);
  // The future job is still gated — nothing else claimable yet.
  expect(store.claimNext()).toBeNull();
  store.close();
});

test('a job whose available_at exactly equals now IS claimable (<= boundary)', () => {
  const store = tempStore();
  const t = Date.now();
  const job = store.enqueue({
    kind: JobKind.Chat,
    payload: 'boundary',
    availableAt: t,
  });
  expect(store.claimNext(t)?.id).toBe(job.id);
  store.close();
});

test('claimNext on an empty store returns null', () => {
  const store = tempStore();
  expect(store.claimNext()).toBeNull();
  store.close();
});
