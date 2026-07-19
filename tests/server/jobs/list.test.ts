import { expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJobStore } from '../../../src/queue/store.ts';
import { JobKind } from '../../../src/queue/types.ts';
import { handleJobDetail } from '../../../src/server/jobs/detail.ts';
import { handleJobList } from '../../../src/server/jobs/list.ts';

const deps = () => ({
  jobStore: createJobStore({ path: mkdtempSync(join(tmpdir(), 'jobs-')) }, {}),
});

test('GET /api/jobs?limit=2 pages 3 enqueued jobs into 2 items + nextCursor + total:3', async () => {
  const d = deps();
  d.jobStore.enqueue({ kind: JobKind.Crew, payload: 'a' });
  d.jobStore.enqueue({ kind: JobKind.Crew, payload: 'b' });
  d.jobStore.enqueue({ kind: JobKind.Crew, payload: 'c' });

  const res = handleJobList(new URLSearchParams('limit=2'), d as never);
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    items: { id: string }[];
    nextCursor?: string;
    total: number;
  };
  expect(body.items.length).toBe(2);
  expect(body.nextCursor).toBeDefined();
  expect(body.total).toBe(3);
});

test('GET /api/jobs?status=queued filters out a claimed (Running) job', async () => {
  const d = deps();
  d.jobStore.enqueue({ kind: JobKind.Crew, payload: 'a' });
  d.jobStore.enqueue({ kind: JobKind.Crew, payload: 'b' });
  const claimed = d.jobStore.claimNext(); // -> Running, whichever wins the claim order

  const res = handleJobList(new URLSearchParams('status=queued'), d as never);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { items: { id: string }[]; total: number };
  expect(body.total).toBe(1);
  expect(body.items.some((i) => i.id === claimed?.id)).toBe(false);
});

test('GET /api/jobs/:id returns the full job record', async () => {
  const d = deps();
  const job = d.jobStore.enqueue({ kind: JobKind.Crew, payload: { x: 1 } });
  const res = handleJobDetail(job.id, d as never);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { id: string };
  expect(body.id).toBe(job.id);
});

test('GET /api/jobs/:id 404s an unknown id', () => {
  const d = deps();
  const res = handleJobDetail('job-nope', d as never);
  expect(res.status).toBe(404);
});
