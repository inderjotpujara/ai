import { expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDaemon } from '../../src/daemon/core.ts';
import { writePid } from '../../src/daemon/pid.ts';
import { createWorkerPool } from '../../src/queue/pool.ts';
import { createJobStore } from '../../src/queue/store.ts';
import { JobKind, JobStatus } from '../../src/queue/types.ts';

test('start reconciles BEFORE pool.start, then injects its OWN pool into the server', async () => {
  const store = createJobStore(
    { path: mkdtempSync(join(tmpdir(), 'jobs-')) },
    {},
  );
  const orphan = store.enqueue({ kind: JobKind.Crew, payload: 1 });
  store.claimNext(); // leave it Running (simulate a crash)

  // Call-order log proves reconcile ran BEFORE the pool started (the §7.3 gate).
  const order: string[] = [];
  const realPool = createWorkerPool({
    store,
    concurrency: 1,
    pollMs: 5,
    dispatch: () => async () => ({}),
  });
  const pool = {
    ...realPool,
    start: () => {
      order.push('pool.start');
      realPool.start();
    },
    stop: async () => {
      await realPool.stop();
    },
  };
  const wrappedStore = {
    ...store,
    reconcileOrphans: () => {
      order.push('reconcile');
      return store.reconcileOrphans();
    },
  };

  // Capture the options startWebServer receives so we can assert injection.
  let received: { queue?: { jobStore: unknown; pool: unknown } } | undefined;
  const pidPath = join(mkdtempSync(join(tmpdir(), 'pid-')), 'daemon.pid');
  const daemon = createDaemon({
    startWebServer: ((opts: {
      queue?: { jobStore: unknown; pool: unknown };
    }) => {
      received = opts;
      return { server: { stop() {} }, token: 't', port: 0 };
    }) as never,
    queue: wrappedStore as never,
    pool: pool as never,
    pidPath,
    installSignals: () => {},
  });

  await daemon.start();
  // The daemon injected its OWN pool + store — startWebServer built no second pool.
  expect(received?.queue?.pool).toBe(pool);
  expect(received?.queue?.jobStore).toBe(wrappedStore);
  // Ordering: reconcile happened before the pool started.
  expect(order).toEqual(['reconcile', 'pool.start']);
  // The orphan was transitioned to Interrupted by reconcile (M3: teeth, not just
  // "left Running"); the full no-double-exec / durable-resume proof under a live
  // pool is the Task 43 restart-durability integration test.
  expect(store.getJob(orphan.id)?.status).toBe(JobStatus.Interrupted);
  expect(daemon.status().running).toBe(true);
  await daemon.stop();
  expect(daemon.status().running).toBe(false);
  store.close();
});

test('start refuses when a live daemon pid is already present (double-start guard)', async () => {
  const pidPath = join(mkdtempSync(join(tmpdir(), 'pid-')), 'daemon.pid');
  writePid(pidPath, process.pid); // current process is alive → a live pid on record

  let reconciled = false;
  let poolStarted = false;
  let serverStarted = false;
  const daemon = createDaemon({
    startWebServer: (() => {
      serverStarted = true;
      return { server: { stop() {} }, token: 't', port: 0 };
    }) as never,
    queue: {
      reconcileOrphans: () => {
        reconciled = true;
        return { interrupted: 0, requeued: 0 };
      },
    } as never,
    pool: {
      start: () => {
        poolStarted = true;
      },
      stop: async () => {},
    } as never,
    pidPath,
    installSignals: () => {},
  });

  await expect(daemon.start()).rejects.toThrow(/already running/);
  // Guard tripped BEFORE any side effect — no reconcile, no pool, no server.
  expect(reconciled).toBe(false);
  expect(poolStarted).toBe(false);
  expect(serverStarted).toBe(false);
});

test('stop drains the pool, clears the pid, and is idempotent (double-stop safe)', async () => {
  const pidPath = join(mkdtempSync(join(tmpdir(), 'pid-')), 'daemon.pid');
  let stopCount = 0;
  const daemon = createDaemon({
    startWebServer: (() => ({
      server: { stop() {} },
      token: 't',
      port: 0,
    })) as never,
    queue: {
      reconcileOrphans: () => ({ interrupted: 0, requeued: 0 }),
    } as never,
    pool: {
      start: () => {},
      stop: async () => {
        stopCount += 1;
      },
    } as never,
    pidPath,
    installSignals: () => {},
  });

  await daemon.start();
  expect(daemon.status().running).toBe(true);
  await daemon.stop();
  await daemon.stop(); // second stop must be a safe no-op
  expect(daemon.status().running).toBe(false);
  expect(stopCount).toBe(1); // pool drained exactly once
});
