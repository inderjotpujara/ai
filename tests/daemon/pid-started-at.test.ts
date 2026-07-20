import { expect, test } from 'bun:test';
import { mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readStartedAt } from '../../src/daemon/pid.ts';

test('readStartedAt returns the pid file mtime in epoch-ms', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'pid-')), 'daemon.pid');
  writeFileSync(path, '4242');
  const when = new Date('2026-07-19T00:00:00Z');
  utimesSync(path, when, when);
  expect(readStartedAt(path)).toBe(when.getTime());
});

test('readStartedAt returns undefined when the pid file is absent', () => {
  expect(
    readStartedAt(join(tmpdir(), 'nope-does-not-exist.pid')),
  ).toBeUndefined();
});
