import { expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startWebServer } from '../../src/server/main.ts';

/**
 * Task 11 wiring: a real (standalone) `startWebServer` boot must populate
 * `queueConcurrency`/`daemonPidPath`/`bindInfo`/`daemonLogDir` on `ServerDeps`
 * for real, so the T8/T9/T10 routes stop 503-ing. This is a thin end-to-end
 * proof over the actual HTTP surface (not the ServerDeps object directly,
 * which isn't exported by the handle) — a 200 from both routes is only
 * possible if `need()` found each field populated.
 */
test('a standalone startWebServer boot populates the ops deps so /api/daemon/status and /api/queue/stats return 200', async () => {
  const prevQueue = process.env.AGENT_QUEUE_PATH;
  process.env.AGENT_QUEUE_PATH = mkdtempSync(join(tmpdir(), 'ops-deps-queue-'));
  const authDir = mkdtempSync(join(tmpdir(), 'ops-deps-auth-'));
  const daemonDir = mkdtempSync(join(tmpdir(), 'ops-deps-daemon-'));
  const handle = startWebServer({
    port: 0,
    rootTokenPath: join(authDir, 'daemon-token'),
    sessionRevocationPath: join(authDir, 'revoked-devices.json'),
    daemonPidPath: join(daemonDir, 'daemon.pid'),
    daemonLogDir: join(daemonDir, 'logs'),
  });
  const base = `http://localhost:${handle.port}`;
  try {
    const statusRes = await fetch(`${base}/api/daemon/status`, {
      headers: { authorization: `Bearer ${handle.token}` },
    });
    expect(statusRes.status).toBe(200);
    const status = (await statusRes.json()) as {
      running: boolean;
      bind: { bind: string; port: number; sessionTtlMs: number };
    };
    // Never having written the pid file, the daemon reads as not-running —
    // but the route itself must succeed (proves daemonPidPath + bindInfo are
    // BOTH populated; either missing would 503 per app.test.ts's 503 tests).
    expect(status.running).toBe(false);
    expect(status.bind).toMatchObject({
      bind: '127.0.0.1',
      port: handle.port,
    });
    expect(typeof status.bind.sessionTtlMs).toBe('number');

    const statsRes = await fetch(`${base}/api/queue/stats`, {
      headers: { authorization: `Bearer ${handle.token}` },
    });
    expect(statsRes.status).toBe(200);
    const stats = (await statsRes.json()) as { concurrency: number };
    // Standalone mode: queueConcurrency is threaded from the SAME
    // computeConcurrency() call the pool itself was built with.
    expect(typeof stats.concurrency).toBe('number');
    expect(stats.concurrency).toBeGreaterThan(0);

    const logsRes = await fetch(`${base}/api/daemon/logs`, {
      headers: { authorization: `Bearer ${handle.token}` },
    });
    // daemonLogDir populated → the route runs (no log files yet → empty lines,
    // never a 503).
    expect(logsRes.status).toBe(200);
    expect(await logsRes.json()).toEqual({ lines: [] });
  } finally {
    await handle.pool.stop();
    handle.server.stop(true);
    handle.jobStore.close();
    if (prevQueue === undefined) delete process.env.AGENT_QUEUE_PATH;
    else process.env.AGENT_QUEUE_PATH = prevQueue;
  }
});
