import { expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DaemonLogsResponse } from '../../../src/contracts/index.ts';
import { handleDaemonLogs } from '../../../src/server/daemon/logs.ts';

function tempLogDir() {
  const dir = mkdtempSync(join(tmpdir(), 'logs-'));
  const hex = 'b'.repeat(64);
  writeFileSync(
    join(dir, 'agent.out.log'),
    `line1\nBearer eyJ.payload.sig\nroot ${hex}\nline4\n`,
  );
  writeFileSync(join(dir, 'agent.err.log'), 'err-a\nerr-b\n');
  return { dir, hex };
}

test('returns the last N redacted lines of the out stream', async () => {
  const { dir, hex } = tempLogDir();
  const res = handleDaemonLogs(new URLSearchParams('tail=2&stream=out'), {
    daemonLogDir: dir,
  });
  const body = (await res.json()) as DaemonLogsResponse;
  expect(body.lines).toHaveLength(2);
  expect(body.lines.join('\n')).not.toContain(hex);
  expect(body.lines.join('\n')).not.toContain('eyJ.payload.sig');
});

test('selects the err stream', async () => {
  const { dir } = tempLogDir();
  const res = handleDaemonLogs(new URLSearchParams('stream=err'), {
    daemonLogDir: dir,
  });
  const body = (await res.json()) as DaemonLogsResponse;
  expect(body.lines).toContain('err-a');
});

test('a bad tail value is a 400', async () => {
  const { dir } = tempLogDir();
  expect(
    handleDaemonLogs(new URLSearchParams('tail=99999'), {
      daemonLogDir: dir,
    }).status,
  ).toBe(400);
});

test('a missing log file yields an empty lines array (not a 500)', async () => {
  const res = handleDaemonLogs(new URLSearchParams(), {
    daemonLogDir: join(tmpdir(), 'no-such-dir'),
  });
  const body = (await res.json()) as DaemonLogsResponse;
  expect(body.lines).toEqual([]);
});

test('the redaction marker appears in the returned lines (secret never leaves raw)', async () => {
  const { dir } = tempLogDir();
  const res = handleDaemonLogs(new URLSearchParams('tail=10&stream=out'), {
    daemonLogDir: dir,
  });
  const body = (await res.json()) as DaemonLogsResponse;
  expect(body.lines.join('\n')).toContain('‹redacted›');
});
