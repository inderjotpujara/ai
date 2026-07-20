import { expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJobStore } from '../../src/queue/store.ts';
import { JobKind } from '../../src/queue/types.ts';

function tempStore() {
  return createJobStore({ path: mkdtempSync(join(tmpdir(), 'jobs-')) }, {});
}

test('a fresh job has retriedFrom null', () => {
  const store = tempStore();
  const job = store.enqueue({ kind: JobKind.Crew, payload: { input: 'go' } });
  expect(job.retriedFrom).toBeNull();
  expect(store.getJob(job.id)?.retriedFrom).toBeNull();
  store.close();
});

test('enqueue stamps retriedFrom when supplied (lineage)', () => {
  const store = tempStore();
  const original = store.enqueue({ kind: JobKind.Crew, payload: 1 });
  const retry = store.enqueue({
    kind: JobKind.Crew,
    payload: 1,
    retriedFrom: original.id,
  });
  expect(retry.retriedFrom).toBe(original.id);
  expect(store.getJob(retry.id)?.retriedFrom).toBe(original.id);
  store.close();
});
