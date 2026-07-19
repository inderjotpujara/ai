import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  clearPid,
  defaultPidPath,
  isPidAlive,
  readPid,
  writePid,
} from '../../src/daemon/pid.ts';

function tmpPidPath(): string {
  return join(mkdtempSync(join(tmpdir(), 'pid-')), 'daemon.pid');
}

test('writePid/readPid round-trips', () => {
  const path = tmpPidPath();
  writePid(path, 4242);
  expect(readPid(path)).toBe(4242);
  clearPid(path);
  expect(readPid(path)).toBeUndefined();
});

test('writePid creates parent dir and writes 0600 perms', () => {
  const path = join(
    mkdtempSync(join(tmpdir(), 'pid-')),
    'nested',
    'sub',
    'daemon.pid',
  );
  writePid(path, 111);
  const st = statSync(path);
  expect(st.mode & 0o777).toBe(0o600);
  expect(readPid(path)).toBe(111);
});

test('isPidAlive is true for our own pid, false for a bogus one', () => {
  expect(isPidAlive(process.pid)).toBe(true);
  expect(isPidAlive(9_999_999)).toBe(false);
});

test('isPidAlive is false for a spawned-then-exited child pid', () => {
  const child = spawnSync(process.execPath, ['-e', 'process.exit(0)']);
  expect(child.status).toBe(0);
  const childPid = child.pid;
  expect(typeof childPid).toBe('number');
  expect(isPidAlive(childPid as number)).toBe(false);
});

test('readPid returns undefined for a missing file', () => {
  const path = tmpPidPath();
  expect(readPid(path)).toBeUndefined();
});

test('readPid returns undefined for a malformed pid file', () => {
  const path = tmpPidPath();
  writePid(path, 1); // seed dir
  writeFileSync(path, 'not-a-pid', { mode: 0o600 }); // overwrite with garbage
  expect(readPid(path)).toBeUndefined();
  clearPid(path);
});

test('readPid returns undefined for a negative or zero pid', () => {
  const path = tmpPidPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, '0', { mode: 0o600 });
  expect(readPid(path)).toBeUndefined();
  writeFileSync(path, '-5', { mode: 0o600 });
  expect(readPid(path)).toBeUndefined();
});

test('clearPid is a no-op when the file does not exist', () => {
  const path = tmpPidPath();
  expect(() => clearPid(path)).not.toThrow();
});

test('defaultPidPath points at ~/.agent/daemon.pid', () => {
  const path = defaultPidPath();
  expect(path.endsWith(join('.agent', 'daemon.pid'))).toBe(true);
});

test('stale-detect: a pid file for a dead process is not alive', () => {
  const path = tmpPidPath();
  writePid(path, 9_999_999);
  const pid = readPid(path);
  expect(pid).toBe(9_999_999);
  expect(isPidAlive(pid ?? 0)).toBe(false);
  clearPid(path);
});
