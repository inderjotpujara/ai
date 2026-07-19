import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunOrigin } from '../../src/contracts/enums.ts';
import { mapRunToDto } from '../../src/run/run-dto.ts';
import type { SpanRecord } from '../../src/telemetry/jsonl-exporter.ts';

function span(
  p: Partial<SpanRecord> & { name: string; spanId: string },
): SpanRecord {
  return {
    kind: 0,
    traceId: 't1',
    parentSpanId: null,
    startUnixNano: 0,
    endUnixNano: 1_000_000,
    durationMs: 1,
    status: { code: 0 },
    attributes: {},
    events: [],
    ...p,
  };
}

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'rd-origin-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function writeRun(
  id: string,
  spans: SpanRecord[],
  extra?: { origin?: string },
) {
  const dir = join(root, id);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, 'spans.jsonl'),
    `${spans.map((s) => JSON.stringify(s)).join('\n')}\n`,
  );
  if (extra?.origin !== undefined) {
    await writeFile(join(dir, 'origin'), extra.origin);
  }
  return dir;
}

test('a run dir with an origin file reading "daemon" maps to RunDTO.origin === RunOrigin.Daemon', async () => {
  await writeRun(
    'run-daemon',
    [span({ name: 'agent.run', spanId: 'a', durationMs: 5 })],
    { origin: 'daemon' },
  );
  const dto = await mapRunToDto(root, 'run-daemon');
  expect(dto?.origin).toBe(RunOrigin.Daemon);
});

test('a run dir without an origin marker defaults to RunOrigin.Manual', async () => {
  await writeRun('run-manual', [
    span({ name: 'agent.run', spanId: 'a', durationMs: 5 }),
  ]);
  const dto = await mapRunToDto(root, 'run-manual');
  expect(dto?.origin).toBe(RunOrigin.Manual);
});
