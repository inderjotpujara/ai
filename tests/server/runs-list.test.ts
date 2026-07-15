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
  root = await mkdtemp(join(tmpdir(), 'list-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function writeRun(
  id: string,
  startNano: number,
  attrs: Record<string, unknown>,
  extraSpans: SpanRecord[] = [],
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
    ...extraSpans,
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

test('sorts newest-first by startMs and reports total', async () => {
  await writeRun('old', 1_000_000_000, {
    'agent.outcome': 'answer',
    'gen_ai.request.model': 'qwen',
  });
  await writeRun('new', 5_000_000_000, {
    'agent.outcome': 'answer',
    'gen_ai.request.model': 'llama',
  });
  const page = await list('');
  expect(page.total).toBe(2);
  expect(page.items.map((i) => i.id)).toEqual(['new', 'old']);
});

test('search filters over id/models/outcome (case-insensitive)', async () => {
  await writeRun('run-a', 2_000_000_000, {
    'agent.outcome': 'answer',
    'gen_ai.request.model': 'qwen3.5:9b',
  });
  await writeRun('run-b', 1_000_000_000, {
    'agent.outcome': 'gap',
    'gen_ai.request.model': 'llama',
  });
  expect((await list('search=QWEN')).items.map((i) => i.id)).toEqual(['run-a']);
  expect((await list('search=gap')).items.map((i) => i.id)).toEqual(['run-b']);
});

test('outcome + degraded facets filter', async () => {
  await writeRun('r-ok', 3_000_000_000, { 'agent.outcome': 'answer' });
  await writeRun('r-gap', 2_000_000_000, { 'agent.outcome': 'gap' });
  await writeRun('r-deg', 1_000_000_000, { 'agent.outcome': 'answer' }, [
    span({
      name: 'agent.delegation',
      spanId: 'd',
      events: [{ name: 'reliability.degrade', timeUnixNano: 0 }],
    }),
  ]);
  expect((await list('outcome=gap')).items.map((i) => i.id)).toEqual(['r-gap']);
  expect((await list('degraded=true')).items.map((i) => i.id)).toEqual([
    'r-deg',
  ]);
});

test('paginates via limit + opaque cursor', async () => {
  await writeRun('a', 3_000_000_000, { 'agent.outcome': 'answer' });
  await writeRun('b', 2_000_000_000, { 'agent.outcome': 'answer' });
  await writeRun('c', 1_000_000_000, { 'agent.outcome': 'answer' });
  const p1 = await list('limit=2');
  expect(p1.items.map((i) => i.id)).toEqual(['a', 'b']);
  expect(p1.nextCursor).toBeDefined();
  const p2 = await list(
    `limit=2&cursor=${encodeURIComponent(p1.nextCursor as string)}`,
  );
  expect(p2.items.map((i) => i.id)).toEqual(['c']);
  expect(p2.nextCursor).toBeUndefined();
});
