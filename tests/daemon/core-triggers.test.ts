import { expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDaemon } from '../../src/daemon/core.ts';
import { startWebServer } from '../../src/server/main.ts';
import type { TriggersEngine } from '../../src/triggers/engine.ts';

/**
 * Task 16 — daemon lifecycle-binding of the triggers engine.
 *
 * The ordering here is the correctness core (D2): the engine is a PRODUCER
 * (it enqueues jobs, never executes them), so it must come up AFTER the
 * consumer (pool + server) is ready, and it must be shut down FIRST — stop
 * producing before draining consumers — so a scheduler/watcher/chain fire can
 * never enqueue onto a pool that is already draining.
 */
test('daemon starts triggers AFTER server and stops them BEFORE the pool', async () => {
  const order: string[] = [];
  const triggers = {
    start: () => {
      order.push('trg.start');
    },
    stop: async () => {
      order.push('trg.stop');
    },
  } as unknown as TriggersEngine;
  const pool = {
    start: () => {
      order.push('pool.start');
    },
    stop: async () => {
      order.push('pool.stop');
    },
  } as never;
  const queue = {
    reconcileOrphans: () => {
      order.push('reconcile');
    },
  } as never;

  // The injected startWebServer spy records that it came up (server.start) AND
  // that the daemon forwarded its engine through `opts.triggers` — the injected
  // server needs the full engine so its /api/triggers routes (Increment 5) can
  // resolve it rather than 503.
  let receivedTriggers: unknown;
  const pidPath = join(mkdtempSync(join(tmpdir(), 'pid-')), 'daemon.pid');
  const daemon = createDaemon({
    startWebServer: ((opts: { triggers?: unknown }) => {
      order.push('server.start');
      receivedTriggers = opts.triggers;
      return { server: { stop() {} }, token: 't', port: 0 };
    }) as never,
    queue,
    pool,
    triggers,
    concurrency: 1,
    pidPath,
    installSignals: () => {},
  });

  await daemon.start();
  await daemon.stop();

  // Start: pool + server come up, THEN triggers (producer last).
  expect(order.slice(0, 4)).toEqual([
    'reconcile',
    'pool.start',
    'server.start',
    'trg.start',
  ]);
  // Stop: triggers FIRST (stop producing), then the pool drains.
  expect(order.slice(4)).toEqual(['trg.stop', 'pool.stop']);
  // The daemon forwarded its engine to the injected server.
  expect(receivedTriggers).toBe(triggers);
});

// Task 16 fix (MEDIUM, review): a throwing producer engine.stop() must not
// skip the consumer drain — `pool.stop()` must still run, and `stop()` itself
// must degrade (log + swallow) rather than reject, so a chokidar/sqlite close
// hiccup can never wedge graceful shutdown.
test('a rejecting triggers.stop() still lets the pool drain and does not reject daemon.stop()', async () => {
  const order: string[] = [];
  const triggers = {
    start: () => {
      order.push('trg.start');
    },
    stop: async () => {
      order.push('trg.stop');
      throw new Error('chokidar close failed');
    },
  } as unknown as TriggersEngine;
  const pool = {
    start: () => {
      order.push('pool.start');
    },
    stop: async () => {
      order.push('pool.stop');
    },
  } as never;
  const queue = {
    reconcileOrphans: () => {
      order.push('reconcile');
    },
  } as never;

  const pidPath = join(mkdtempSync(join(tmpdir(), 'pid-')), 'daemon.pid');
  const daemon = createDaemon({
    startWebServer: (() => {
      order.push('server.start');
      return { server: { stop() {} }, token: 't', port: 0 };
    }) as never,
    queue,
    pool,
    triggers,
    concurrency: 1,
    pidPath,
    installSignals: () => {},
  });

  await daemon.start();
  await expect(daemon.stop()).resolves.toBeUndefined();

  // The pool drained despite the engine's stop() rejecting.
  expect(order).toEqual([
    'reconcile',
    'pool.start',
    'server.start',
    'trg.start',
    'trg.stop',
    'pool.stop',
  ]);
});

// I3 invariant: a standalone startWebServer with the flag OFF (the default, as
// every existing server test) does NOT construct/start a triggers engine — no
// scheduler interval, no chokidar watcher, no open handle.
test('standalone startWebServer does NOT construct a triggers engine when AGENT_TRIGGERS_ENABLED is off', async () => {
  const prevQueue = process.env.AGENT_QUEUE_PATH;
  const prevFlag = process.env.AGENT_TRIGGERS_ENABLED;
  process.env.AGENT_QUEUE_PATH = mkdtempSync(join(tmpdir(), 'trg-off-queue-'));
  delete process.env.AGENT_TRIGGERS_ENABLED; // default OFF
  const authDir = mkdtempSync(join(tmpdir(), 'trg-off-auth-'));
  const h = startWebServer({
    port: 0,
    rootTokenPath: join(authDir, 'daemon-token'),
    sessionRevocationPath: join(authDir, 'revoked-devices.json'),
  });
  try {
    expect(h.triggers).toBeUndefined(); // no engine → no scheduler/watcher handle
  } finally {
    await h.pool.stop();
    h.server.stop(true);
    h.jobStore.close();
    if (prevQueue === undefined) delete process.env.AGENT_QUEUE_PATH;
    else process.env.AGENT_QUEUE_PATH = prevQueue;
    if (prevFlag === undefined) delete process.env.AGENT_TRIGGERS_ENABLED;
    else process.env.AGENT_TRIGGERS_ENABLED = prevFlag;
  }
});

// The other half of I3: with the flag ON, standalone startWebServer DOES
// construct + own the engine (and can tear it down cleanly).
test('standalone startWebServer constructs + owns a triggers engine when AGENT_TRIGGERS_ENABLED is on', async () => {
  const prevQueue = process.env.AGENT_QUEUE_PATH;
  const prevFlag = process.env.AGENT_TRIGGERS_ENABLED;
  const prevWatch = process.env.AGENT_TRIGGERS_WATCH_ROOT;
  process.env.AGENT_QUEUE_PATH = mkdtempSync(join(tmpdir(), 'trg-on-queue-'));
  process.env.AGENT_TRIGGERS_WATCH_ROOT = mkdtempSync(
    join(tmpdir(), 'trg-on-watch-'),
  );
  process.env.AGENT_TRIGGERS_ENABLED = '1';
  const authDir = mkdtempSync(join(tmpdir(), 'trg-on-auth-'));
  const h = startWebServer({
    port: 0,
    rootTokenPath: join(authDir, 'daemon-token'),
    sessionRevocationPath: join(authDir, 'revoked-devices.json'),
  });
  try {
    expect(h.triggers).toBeDefined();
  } finally {
    await h.triggers?.stop(); // releases scheduler interval + chokidar watcher
    await h.pool.stop();
    h.server.stop(true);
    h.jobStore.close();
    if (prevQueue === undefined) delete process.env.AGENT_QUEUE_PATH;
    else process.env.AGENT_QUEUE_PATH = prevQueue;
    if (prevFlag === undefined) delete process.env.AGENT_TRIGGERS_ENABLED;
    else process.env.AGENT_TRIGGERS_ENABLED = prevFlag;
    if (prevWatch === undefined) delete process.env.AGENT_TRIGGERS_WATCH_ROOT;
    else process.env.AGENT_TRIGGERS_WATCH_ROOT = prevWatch;
  }
});
