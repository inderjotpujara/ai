import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunLifecycle } from '../../src/contracts/enums.ts';
import {
  __summaryCacheSize,
  summarizeRunListItem,
} from '../../src/run/run-dto.ts';
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
  root = await mkdtemp(join(tmpdir(), 'rs-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function write(id: string, spans: SpanRecord[]) {
  const dir = join(root, id);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, 'spans.jsonl'),
    `${spans.map((s) => JSON.stringify(s)).join('\n')}\n`,
  );
  return dir;
}

test('summarizes an agent.run without spans/artifacts arrays', async () => {
  await write('r1', [
    span({
      name: 'agent.run',
      spanId: 'a',
      durationMs: 5,
      attributes: {
        'agent.outcome': 'answer',
        'gen_ai.request.model': 'm',
      },
    }),
  ]);
  const item = await summarizeRunListItem(root, 'r1');
  expect(item?.outcome).toBe('answer');
  expect(item?.lifecycle).toBe(RunLifecycle.Done);
  expect(item?.models).toEqual(['m']);
  expect(item?.spanCount).toBe(1);
  expect(item && 'spans' in item).toBe(false);
  expect(item && 'artifacts' in item).toBe(false);
});

test('guardrail: completed crew.run (no agent.run) gets Done lifecycle + non-zero duration, NOT the agent.run-only bug', async () => {
  await write('r-crew', [
    span({
      name: 'crew.run',
      spanId: 'c',
      startUnixNano: 2_000_000_000,
      durationMs: 42,
      attributes: { 'crew.id': 'writers', 'agent.outcome': 'answer' },
    }),
    span({
      name: 'workflow.step',
      spanId: 's1',
      parentSpanId: 'c',
      startUnixNano: 2_005_000_000,
      durationMs: 20,
    }),
  ]);
  const item = await summarizeRunListItem(root, 'r-crew');
  expect(item?.lifecycle).toBe(RunLifecycle.Done);
  expect(item?.durationMs).toBe(42);
  expect(item?.outcome).toBe('answer');
  expect(item?.startMs).toBe(2000);
});

test('guardrail: completed workflow.run (no agent.run) gets Done lifecycle + non-zero duration', async () => {
  await write('r-wf', [
    span({
      name: 'workflow.run',
      spanId: 'w',
      startUnixNano: 3_000_000_000,
      durationMs: 33,
      attributes: { 'workflow.id': 'pipeline', 'agent.outcome': 'answer' },
    }),
  ]);
  const item = await summarizeRunListItem(root, 'r-wf');
  expect(item?.lifecycle).toBe(RunLifecycle.Done);
  expect(item?.durationMs).toBe(33);
  expect(item?.outcome).toBe('answer');
});

test('guardrail: crew.run root with resource outcome → Failed lifecycle', async () => {
  await write('r-crew-fail', [
    span({
      name: 'crew.run',
      spanId: 'c',
      durationMs: 12,
      attributes: { 'crew.id': 'writers', 'agent.outcome': 'resource' },
    }),
  ]);
  const item = await summarizeRunListItem(root, 'r-crew-fail');
  expect(item?.lifecycle).toBe(RunLifecycle.Failed);
  expect(item?.outcome).toBe('resource');
});

test('degraded=true derived from span reliability.degrade events (no degrades-file read)', async () => {
  await write('r-degrade', [
    span({
      name: 'agent.run',
      spanId: 'a',
      events: [
        {
          name: 'reliability.degrade',
          timeUnixNano: 0,
          attributes: { 'degrade.subject': 'voice' },
        },
      ],
    }),
  ]);
  const item = await summarizeRunListItem(root, 'r-degrade');
  expect(item?.degraded).toBe(true);
});

test('memoizes on unchanged spans.jsonl mtime, recomputes when it changes', async () => {
  await write('r2', [span({ name: 'agent.run', spanId: 'a' })]);
  await summarizeRunListItem(root, 'r2');
  const sizeAfterFirst = __summaryCacheSize();
  const first = await summarizeRunListItem(root, 'r2'); // cache hit — no new entry
  expect(__summaryCacheSize()).toBe(sizeAfterFirst);
  expect(first?.spanCount).toBe(1);
  // append a span → file mtime changes → recompute
  await new Promise((r) => setTimeout(r, 10));
  await writeFile(
    join(root, 'r2', 'spans.jsonl'),
    `${JSON.stringify(span({ name: 'agent.run', spanId: 'a' }))}\n${JSON.stringify(
      span({ name: 'x', spanId: 'b' }),
    )}\n`,
  );
  const item = await summarizeRunListItem(root, 'r2');
  expect(item?.spanCount).toBe(2);
});

test('a chat.run-rooted run resolves a real lifecycle/durationMs, not a ghost Running (D9, §7.2a)', async () => {
  await write('rc', [
    span({
      name: 'chat.run',
      spanId: 'c',
      durationMs: 42,
      attributes: { 'agent.outcome': 'answer' },
    }),
  ]);
  const item = await summarizeRunListItem(root, 'rc');
  expect(item?.lifecycle).toBe(RunLifecycle.Done);
  expect(item?.lifecycle).not.toBe(RunLifecycle.Running);
  expect(item?.durationMs).toBe(42);
  expect(item?.outcome).toBe('answer');
});

test('undefined for a run with no spans', async () => {
  expect(await summarizeRunListItem(root, 'nope')).toBeUndefined();
});
