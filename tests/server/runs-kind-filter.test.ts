import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RunListResponse } from '../../src/contracts/requests.ts';
import { handleRunList } from '../../src/server/runs/list.ts';
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
  root = await mkdtemp(join(tmpdir(), 'kindfilter-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function writeRun(id: string, rootSpanName: string, startNano: number) {
  const dir = join(root, id);
  await mkdir(dir, { recursive: true });
  const spans = [
    span({
      name: rootSpanName,
      spanId: `${id}-a`,
      startUnixNano: startNano,
      attributes: { 'agent.outcome': 'answer' },
    }),
  ];
  await writeFile(
    join(dir, 'spans.jsonl'),
    `${spans.map((s) => JSON.stringify(s)).join('\n')}\n`,
  );
}

async function list(qs: string): Promise<RunListResponse> {
  const res = await handleRunList(new URLSearchParams(qs), { runsRoot: root });
  expect(res.status).toBe(200);
  return (await res.json()) as RunListResponse;
}

test('kind facet filters run summaries by their derived RunKind', async () => {
  await writeRun('crew-run', 'crew.run', 1_000_000_000);
  await writeRun('flow-run', 'workflow.run', 2_000_000_000);
  await writeRun('agent-run', 'agent.run', 3_000_000_000);

  expect((await list('kind=crew')).items.map((i) => i.id)).toEqual([
    'crew-run',
  ]);
  expect((await list('kind=workflow')).items.map((i) => i.id)).toEqual([
    'flow-run',
  ]);
  expect((await list('kind=agent')).items.map((i) => i.id)).toEqual([
    'agent-run',
  ]);
  expect((await list('')).total).toBe(3);
});

test('an unrecognized kind value is rejected with 400 (bad request), not 500', async () => {
  const res = await handleRunList(new URLSearchParams('kind=nonsense'), {
    runsRoot: root,
  });
  expect(res.status).toBe(400);
});
