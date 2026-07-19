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

test('buildTree treats a span whose parentSpanId equals its own spanId as a root (no infinite recursion)', () => {
  const tree = buildTree([
    span({ name: 'self-ref', spanId: 'loop', parentSpanId: 'loop' }),
  ]);
  expect(tree).toHaveLength(1);
  expect(tree[0]?.span.name).toBe('self-ref');
  expect(tree[0]?.children).toHaveLength(0);
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

// D9 blast-radius: summarizeRun used to key the root off `agent.run` only, so
// a chat turn (`chat.run`), crew (`crew.run`) or workflow (`workflow.run`) run
// reported durationMs 0 / outcome 'unknown' in the CLI `runs` list. It must
// now find the root via the shared RUN_ROOT_NAMES set.
test.each([
  'chat.run',
  'crew.run',
  'workflow.run',
])('summarizeRun reports real durationMs/outcome for a %s-rooted trace (not 0/unknown)', async (rootName) => {
  const dir = join(root, `run-${rootName}`);
  await mkdir(dir, { recursive: true });
  const rootSpan = span({
    name: rootName,
    spanId: 'a',
    durationMs: 314,
    attributes: { 'agent.outcome': 'answer' },
  });
  await writeFile(join(dir, 'spans.jsonl'), `${JSON.stringify(rootSpan)}\n`);
  const s = await summarizeRun(root, `run-${rootName}`);
  // Would be durationMs 0 / outcome 'unknown' under the old agent.run-only
  // lookup (the root would go unrecognized and fall through to defaults).
  expect(s?.durationMs).toBe(314);
  expect(s?.outcome).toBe('answer');
});

test('summarizeRun falls back to spans[0] when no recognized run root is present (never throws)', async () => {
  const dir = join(root, 'run-no-root');
  await mkdir(dir, { recursive: true });
  const only = span({
    name: 'ai.generateText',
    spanId: 'a',
    durationMs: 7,
    startUnixNano: 5_000_000,
  });
  await writeFile(join(dir, 'spans.jsonl'), `${JSON.stringify(only)}\n`);
  const s = await summarizeRun(root, 'run-no-root');
  // No recognized root → durationMs 0 / outcome unknown, but startMs still
  // derives from spans[0] and the call does not throw.
  expect(s?.durationMs).toBe(0);
  expect(s?.outcome).toBe('unknown');
  expect(s?.startMs).toBe(5);
});
