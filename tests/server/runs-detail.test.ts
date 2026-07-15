import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleRunDetail } from '../../src/server/runs/detail.ts';
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
    durationMs: 1,
    status: { code: 0 },
    attributes: {},
    events: [],
    ...p,
  };
}

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'det-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

test('200 with a RunDTO for an existing run', async () => {
  const dir = join(root, 'run-1');
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, 'spans.jsonl'),
    `${JSON.stringify(span({ name: 'agent.run', spanId: 'a', attributes: { 'agent.outcome': 'answer' } }))}\n`,
  );
  const res = await handleRunDetail('run-1', { runsRoot: root });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { id: string; outcome: string };
  expect(body.id).toBe('run-1');
  expect(body.outcome).toBe('answer');
  expect(res.headers.get('cross-origin-opener-policy')).toBe('same-origin');
});

test('404 for a missing run', async () => {
  const res = await handleRunDetail('nope', { runsRoot: root });
  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({ error: 'not found' });
});

test('path traversal on :id → 404 (no leak, MediaPathError)', async () => {
  const res = await handleRunDetail('../../../../etc', { runsRoot: root });
  expect(res.status).toBe(404);
});
