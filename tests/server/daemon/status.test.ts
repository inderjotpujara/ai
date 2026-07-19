import { expect, test } from 'bun:test';
import { mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DaemonStatusDTO } from '../../../src/contracts/index.ts';
import { handleDaemonStatus } from '../../../src/server/daemon/status.ts';

const bindInfo = {
  bind: '127.0.0.1',
  allowedHosts: ['ts.example'],
  port: 4130,
  sessionTtlMs: 100,
};

test('reports running + pid + uptime derived from the pid mtime, plus bind', async () => {
  const path = join(mkdtempSync(join(tmpdir(), 'pid-')), 'daemon.pid');
  writeFileSync(path, String(process.pid)); // a LIVE pid so readLivePid keeps it
  const when = Date.now() - 5000;
  utimesSync(path, new Date(when), new Date(when));
  const res = handleDaemonStatus({ daemonPidPath: path, bindInfo });
  const body = (await res.json()) as DaemonStatusDTO;
  expect(body.running).toBe(true);
  expect(body.pid).toBe(process.pid);
  expect(body.uptimeMs).toBeGreaterThanOrEqual(4000); // ~5s, derived from mtime
  expect(body.uptimeMs).toBeLessThan(60000); // excludes a process.uptime()-style regression
  expect(body.bind).toEqual(bindInfo);
});

test('clamps uptimeMs to 0 when the pid mtime is in the future (clock skew)', async () => {
  const path = join(mkdtempSync(join(tmpdir(), 'pid-')), 'daemon.pid');
  writeFileSync(path, String(process.pid)); // a LIVE pid so readLivePid keeps it
  const when = Date.now() + 5000;
  utimesSync(path, new Date(when), new Date(when));
  const res = handleDaemonStatus({ daemonPidPath: path, bindInfo });
  const body = (await res.json()) as DaemonStatusDTO;
  expect(body.uptimeMs).toBe(0);
});

test('reports not-running with no pid/uptime when the pid file is absent', async () => {
  const res = handleDaemonStatus({
    daemonPidPath: join(tmpdir(), 'absent.pid'),
    bindInfo,
  });
  const body = (await res.json()) as DaemonStatusDTO;
  expect(body.running).toBe(false);
  expect(body.pid).toBeUndefined();
  expect(body.uptimeMs).toBeUndefined();
});
