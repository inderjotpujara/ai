import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listRuns, renderRun } from '../../src/cli/runs.ts';
import type { SpanRecord } from '../../src/telemetry/jsonl-exporter.ts';

function span(
  p: Partial<SpanRecord> & { name: string; spanId: string },
): SpanRecord {
  return {
    kind: 0,
    traceId: 't',
    parentSpanId: null,
    startUnixNano: 0,
    endUnixNano: 1_000_000,
    durationMs: 3,
    status: { code: 0 },
    attributes: {},
    events: [],
    ...p,
  };
}

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'runs-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function writeRun(id: string, spans: SpanRecord[]): Promise<void> {
  const dir = join(root, id);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, 'spans.jsonl'),
    `${spans.map((s) => JSON.stringify(s)).join('\n')}\n`,
  );
}

test('renderRun shows the timeline for a run', async () => {
  await writeRun('run-1', [
    span({
      name: 'agent.run',
      spanId: 'a',
      attributes: { 'agent.outcome': 'answer' },
    }),
  ]);
  const out = await renderRun(root, 'run-1');
  expect(out).toContain('agent.run');
  expect(out).toContain('answer');
});

test('renderRun reports a clear message when the run is missing', async () => {
  const out = await renderRun(root, 'nope');
  expect(out.toLowerCase()).toContain('no spans');
});

test('listRuns lists runs found under the root', async () => {
  await writeRun('run-1', [span({ name: 'agent.run', spanId: 'a' })]);
  const out = await listRuns(root);
  expect(out).toContain('run-1');
});
