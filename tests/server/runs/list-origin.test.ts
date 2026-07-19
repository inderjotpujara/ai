import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RunListResponse } from '../../../src/contracts/requests.ts';
import { handleRunList } from '../../../src/server/runs/list.ts';
import type { SpanRecord } from '../../../src/telemetry/jsonl-exporter.ts';

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
  root = await mkdtemp(join(tmpdir(), 'list-origin-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function writeRun(
  id: string,
  startNano: number,
  attrs: Record<string, unknown>,
  origin?: string,
) {
  const dir = join(root, id);
  await mkdir(dir, { recursive: true });
  const spans = [
    span({
      name: 'agent.run',
      spanId: `${id}-a`,
      startUnixNano: startNano,
      attributes: attrs,
    }),
  ];
  await writeFile(
    join(dir, 'spans.jsonl'),
    `${spans.map((s) => JSON.stringify(s)).join('\n')}\n`,
  );
  if (origin) await writeFile(join(dir, 'origin'), origin);
}

test('origin facet filters to daemon-dispatched runs only', async () => {
  await writeRun(
    'daemon-run',
    2_000_000_000,
    { 'agent.outcome': 'answer' },
    'daemon',
  );
  await writeRun('manual-run', 1_000_000_000, { 'agent.outcome': 'answer' });

  const res = await handleRunList(new URLSearchParams('origin=daemon'), {
    runsRoot: root,
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as RunListResponse;
  expect(body.items.map((i) => i.id)).toEqual(['daemon-run']);
});
