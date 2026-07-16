import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunLifecycle } from '../../src/contracts/enums.ts';
import { mapRunToDto, summarizeRunListItem } from '../../src/run/run-dto.ts';
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
  root = await mkdtemp(join(tmpdir(), 'el-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function writeErrorJson(id: string): Promise<string> {
  const dir = join(root, id);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'error.json'), JSON.stringify({ error: 'boom' }));
  return dir;
}

async function writeSpans(dir: string, spans: SpanRecord[]): Promise<void> {
  await writeFile(
    join(dir, 'spans.jsonl'),
    `${spans.map((s) => JSON.stringify(s)).join('\n')}\n`,
  );
}

test('mapRunToDto: error.json + NO spans.jsonl at all → terminal Failed, outcome=error', async () => {
  await writeErrorJson('run-early-1');
  const dto = await mapRunToDto(root, 'run-early-1');
  expect(dto).toBeDefined();
  expect(dto?.lifecycle).toBe(RunLifecycle.Failed);
  expect(dto?.outcome).toBe('error');
  expect(dto?.spanCount).toBe(0);
  expect(dto?.artifacts.map((a) => a.name)).toContain('error.json');
});

test('mapRunToDto: error.json + spans.jsonl with only a non-root span (agent.delegation) → terminal Failed, outcome=error', async () => {
  const dir = await writeErrorJson('run-early-2');
  await writeSpans(dir, [
    span({
      name: 'agent.delegation',
      spanId: 'm1',
      attributes: { 'agent.delegation.target': 'researcher' },
    }),
  ]);
  const dto = await mapRunToDto(root, 'run-early-2');
  expect(dto?.lifecycle).toBe(RunLifecycle.Failed);
  expect(dto?.outcome).toBe('error');
  expect(dto?.spanCount).toBe(1);
});

test('mapRunToDto: a completed crew.run root wins over a coincidental error.json', async () => {
  const dir = await writeErrorJson('run-completed-with-error');
  await writeSpans(dir, [
    span({
      name: 'crew.run',
      spanId: 'c',
      durationMs: 42,
      attributes: { 'crew.id': 'writers', 'agent.outcome': 'answer' },
    }),
  ]);
  const dto = await mapRunToDto(root, 'run-completed-with-error');
  expect(dto?.lifecycle).toBe(RunLifecycle.Done);
  expect(dto?.outcome).toBe('answer');
});

test('mapRunToDto: an in-flight run with no error.json stays Running (unaffected)', async () => {
  const dir = join(root, 'run-inflight');
  await mkdir(dir, { recursive: true });
  await writeSpans(dir, [span({ name: 'agent.delegation', spanId: 'm1' })]);
  const dto = await mapRunToDto(root, 'run-inflight');
  expect(dto?.lifecycle).toBe(RunLifecycle.Running);
});

test('summarizeRunListItem: error.json + spans.jsonl with only a non-root span → terminal Failed, outcome=error', async () => {
  const dir = await writeErrorJson('run-early-list');
  await writeSpans(dir, [span({ name: 'agent.delegation', spanId: 'm1' })]);
  const item = await summarizeRunListItem(root, 'run-early-list');
  expect(item?.lifecycle).toBe(RunLifecycle.Failed);
  expect(item?.outcome).toBe('error');
});

test('summarizeRunListItem: error.json + NO spans.jsonl at all → Failed (not hidden from the list)', async () => {
  // I2: the spans.jsonl stat gate returned undefined here, hiding a run that
  // failed before any span flushed — while mapRunToDto rescued it in detail.
  await writeErrorJson('run-early-list-nospans');
  const item = await summarizeRunListItem(root, 'run-early-list-nospans');
  expect(item).toBeDefined();
  expect(item?.lifecycle).toBe(RunLifecycle.Failed);
  expect(item?.outcome).toBe('error');
  expect(item?.spanCount).toBe(0);
});

test('summarizeRunListItem: a stale cached Running is rescued to Failed when error.json appears', async () => {
  // I1: error.json is written WITHOUT touching spans.jsonl, so the mtime cache
  // key never invalidates; a cached Running item would otherwise stick forever.
  const dir = join(root, 'run-stale-cache');
  await mkdir(dir, { recursive: true });
  await writeSpans(dir, [span({ name: 'agent.delegation', spanId: 'm1' })]);
  const first = await summarizeRunListItem(root, 'run-stale-cache');
  expect(first?.lifecycle).toBe(RunLifecycle.Running); // caches Running
  // No spans change — only error.json is added.
  await writeFile(join(dir, 'error.json'), JSON.stringify({ error: 'boom' }));
  const second = await summarizeRunListItem(root, 'run-stale-cache');
  expect(second?.lifecycle).toBe(RunLifecycle.Failed);
  expect(second?.outcome).toBe('error');
});

test('summarizeRunListItem: a completed agent.run root wins over a coincidental error.json', async () => {
  const dir = await writeErrorJson('run-list-completed-with-error');
  await writeSpans(dir, [
    span({
      name: 'agent.run',
      spanId: 'a',
      attributes: { 'agent.outcome': 'answer' },
    }),
  ]);
  const item = await summarizeRunListItem(
    root,
    'run-list-completed-with-error',
  );
  expect(item?.lifecycle).toBe(RunLifecycle.Done);
  expect(item?.outcome).toBe('answer');
});
