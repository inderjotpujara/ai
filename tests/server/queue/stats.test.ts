import { expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { QueueStatsDTO } from '../../../src/contracts/index.ts';
import { createJobStore } from '../../../src/queue/store.ts';
import { JobKind } from '../../../src/queue/types.ts';
import { DepUnavailableError, need } from '../../../src/server/app.ts';
import { handleQueueStats } from '../../../src/server/queue/stats.ts';

test('GET /api/queue/stats reports counts + activeCount + concurrency', async () => {
  const jobStore = createJobStore(
    { path: mkdtempSync(join(tmpdir(), 'jobs-')) },
    {},
  );
  jobStore.enqueue({ kind: JobKind.Crew, payload: 1 });
  const pool = { activeCount: () => 0 } as { activeCount(): number };
  const res = handleQueueStats({ jobStore, pool, queueConcurrency: 4 });
  expect(res.status).toBe(200);
  const body = (await res.json()) as QueueStatsDTO;
  expect(body.total).toBe(1);
  expect(body.counts.queued).toBe(1);
  expect(body.concurrency).toBe(4);
  expect(body.activeCount).toBe(0);
  jobStore.close();
});

test('need() returns a present value and throws DepUnavailableError when unset', () => {
  expect(need(7, 'queueConcurrency')).toBe(7);
  expect(need(0, 'queueConcurrency')).toBe(0); // 0 is present, not "missing"
  expect(() => need(undefined, 'queueConcurrency')).toThrow(
    DepUnavailableError,
  );
  try {
    need<number>(undefined, 'queueConcurrency');
  } catch (err) {
    expect(err).toBeInstanceOf(DepUnavailableError);
    expect((err as DepUnavailableError).field).toBe('queueConcurrency');
    expect((err as DepUnavailableError).name).toBe('DepUnavailableError');
    expect((err as Error).message).toBe(
      'server dependency not configured: queueConcurrency',
    );
  }
});
