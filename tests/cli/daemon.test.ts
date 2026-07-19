import { expect, test } from 'bun:test';
import { runDaemonCli } from '../../src/cli/daemon.ts';

function harness() {
  const calls: string[][] = [];
  const writes: { path: string; body: string }[] = [];
  const out: string[] = [];
  const deps = {
    run: (cmd: string, args: string[]) => {
      calls.push([cmd, ...args]);
    },
    writeFile: (path: string, body: string) => {
      writes.push({ path, body });
    },
    plistPath: '/Users/me/Library/LaunchAgents/io.acceldata.agent.plist',
    renderPlist: () => '<?xml version="1.0"?>',
    status: () => ({ running: false }),
    stopDaemon: async () => {},
    startForeground: async () => {},
    logPaths: ['/Users/me/.agent/logs/agent.out.log'],
    platform: 'darwin' as NodeJS.Platform,
    print: (s: string) => out.push(s),
  };
  return { deps, calls, writes, out };
}

test('install writes the plist then launchctl load', async () => {
  const h = harness();
  await runDaemonCli(['install'], h.deps as never);
  expect(h.writes[0]?.path).toBe(h.deps.plistPath);
  expect(h.calls).toContainEqual(['launchctl', 'load', h.deps.plistPath]);
});

test('status with a dead pid prints "not running"', async () => {
  const h = harness();
  await runDaemonCli(['status'], h.deps as never);
  expect(h.out.join('\n')).toContain('not running');
});

test('stop calls launchctl unload', async () => {
  const h = harness();
  await runDaemonCli(['stop'], h.deps as never);
  expect(h.calls).toContainEqual(['launchctl', 'unload', h.deps.plistPath]);
});

test('install on linux prints systemd guidance and does not shell out', async () => {
  const h = harness();
  await runDaemonCli(['install'], { ...h.deps, platform: 'linux' } as never);
  expect(h.out.join('\n')).toMatch(/systemd/i);
  expect(h.calls).toHaveLength(0);
});
