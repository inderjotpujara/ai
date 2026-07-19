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

// §7.3 adversarial-review regression: the read must be BOUNDED to a tail of
// the file, not a whole-file read, so a rotation-less always-on daemon's
// multi-GB log can't block the event loop / OOM the host. This test writes a
// file well past the 1 MiB read cap and asserts the bounded reader still
// returns the correct last-N lines.
test('a log file larger than the read cap still returns the correct last-N lines (bounded tail read)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'logs-big-'));
  const padLine = 'x'.repeat(200); // ~200 bytes/line
  const lineCount = 10_000; // ~2 MiB total, comfortably past the 1 MiB cap
  const bodyLines: string[] = [];
  for (let i = 0; i < lineCount; i++) bodyLines.push(`${padLine}-${i}`);
  const content = `${bodyLines.join('\n')}\n`;
  writeFileSync(join(dir, 'agent.out.log'), content);

  const res = handleDaemonLogs(new URLSearchParams('tail=3&stream=out'), {
    daemonLogDir: dir,
  });
  const body = (await res.json()) as DaemonLogsResponse;
  expect(body.lines).toEqual([
    `${padLine}-${lineCount - 3}`,
    `${padLine}-${lineCount - 2}`,
    `${padLine}-${lineCount - 1}`,
  ]);
});
