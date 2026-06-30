import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildTree, readSpans, summarizeRun } from '../../src/run/run-trace.ts';
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
  root = await mkdtemp(join(tmpdir(), 'rt-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

test('buildTree links children to parents and sorts by start time', () => {
  const spans = [
    span({ name: 'agent.run', spanId: 'a', startUnixNano: 0 }),
    span({
      name: 'agent.delegation',
      spanId: 'c',
      parentSpanId: 'a',
      startUnixNano: 20,
    }),
    span({
      name: 'ai.generateText',
      spanId: 'b',
      parentSpanId: 'a',
      startUnixNano: 10,
    }),
  ];
  const tree = buildTree(spans);
  expect(tree).toHaveLength(1);
  expect(tree[0]?.span.name).toBe('agent.run');
  expect(tree[0]?.children.map((c) => c.span.name)).toEqual([
    'ai.generateText',
    'agent.delegation',
  ]);
});

test('buildTree promotes orphans (missing parent) to roots', () => {
  const tree = buildTree([
    span({ name: 'orphan', spanId: 'x', parentSpanId: 'missing' }),
  ]);
  expect(tree).toHaveLength(1);
  expect(tree[0]?.span.name).toBe('orphan');
});

test('readSpans parses good lines and counts malformed ones', async () => {
  const dir = join(root, 'run-1');
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, 'spans.jsonl'),
    `${JSON.stringify(span({ name: 'agent.run', spanId: 'a' }))}\nNOT JSON\n`,
  );
  const { spans, malformed } = await readSpans(dir);
  expect(spans).toHaveLength(1);
  expect(malformed).toBe(1);
});

test('summarizeRun derives outcome + models from the root and model attrs', async () => {
  const dir = join(root, 'run-2');
  await mkdir(dir, { recursive: true });
  const rootSpan = span({
    name: 'agent.run',
    spanId: 'a',
    durationMs: 42,
    attributes: { 'agent.outcome': 'answer' },
  });
  const loadSpan = span({
    name: 'agent.model.load',
    spanId: 'b',
    parentSpanId: 'a',
    attributes: { 'gen_ai.request.model': 'qwen3.5:9b' },
  });
  await writeFile(
    join(dir, 'spans.jsonl'),
    `${JSON.stringify(rootSpan)}\n${JSON.stringify(loadSpan)}\n`,
  );
  const s = await summarizeRun(root, 'run-2');
  expect(s?.outcome).toBe('answer');
  expect(s?.durationMs).toBe(42);
  expect(s?.models).toContain('qwen3.5:9b');
});
