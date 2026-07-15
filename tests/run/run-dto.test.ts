import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunDtoSchema } from '../../src/contracts/dto.ts';
import { RunLifecycle, SpanStatus } from '../../src/contracts/enums.ts';
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
  root = await mkdtemp(join(tmpdir(), 'rd-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function writeRun(
  id: string,
  spans: SpanRecord[],
  extra?: { degradation?: string },
) {
  const dir = join(root, id);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, 'spans.jsonl'),
    `${spans.map((s) => JSON.stringify(s)).join('\n')}\n`,
  );
  if (extra?.degradation) {
    await writeFile(join(dir, 'degradation.jsonl'), extra.degradation);
  }
  return dir;
}

test('maps a clean run: offsets, depth, tokens sum, Done lifecycle; validates through RunDtoSchema', async () => {
  await writeRun('run-1', [
    span({
      name: 'agent.run',
      spanId: 'a',
      startUnixNano: 1_000_000_000,
      durationMs: 50,
      attributes: { 'agent.outcome': 'answer', 'content.policy': 'standard' },
    }),
    span({
      name: 'ai.generateText',
      spanId: 'b',
      parentSpanId: 'a',
      startUnixNano: 1_010_000_000, // +10ms
      durationMs: 30,
      attributes: {
        'gen_ai.request.model': 'qwen3.5:9b',
        'gen_ai.usage.input_tokens': 12,
        'gen_ai.usage.output_tokens': 8,
      },
    }),
  ]);
  const dto = await mapRunToDto(root, 'run-1');
  expect(dto).toBeDefined();
  const parsed = RunDtoSchema.parse(dto); // throws if the mapper produced a bad shape
  expect(parsed.lifecycle).toBe(RunLifecycle.Done);
  expect(parsed.outcome).toBe('answer');
  expect(parsed.contentPolicy).toBe('standard');
  expect(parsed.models).toEqual(['qwen3.5:9b']);
  expect(parsed.tokens).toEqual({ input: 12, output: 8 });
  expect(parsed.startMs).toBe(1000);
  expect(parsed.durationMs).toBe(50);
  expect(parsed.roots).toEqual(['a']);
  const rootSpan = parsed.spans.find((s) => s.spanId === 'a');
  expect(rootSpan?.depth).toBe(0);
  expect(rootSpan?.offsetMs).toBe(0);
  const child = parsed.spans.find((s) => s.spanId === 'b');
  expect(child?.depth).toBe(1);
  expect(child?.offsetMs).toBe(10);
  expect(child?.tokens).toEqual({ input: 12, output: 8 });
  expect(child?.model?.id).toBe('qwen3.5:9b');
  expect(child?.status).toBe(SpanStatus.Ok);
  expect(dto?.degraded).toBe(false);
});

test('error root → Failed lifecycle + span status Error (code 2)', async () => {
  await writeRun('run-2', [
    span({
      name: 'agent.run',
      spanId: 'a',
      status: { code: 2, message: 'boom' },
      attributes: { 'agent.outcome': 'resource' },
    }),
  ]);
  const dto = await mapRunToDto(root, 'run-2');
  expect(dto?.lifecycle).toBe(RunLifecycle.Failed);
  expect(dto?.spans[0]?.status).toBe(SpanStatus.Error);
  expect(dto?.spans[0]?.statusMessage).toBe('boom');
});

test('outcome=resource on a non-error root still → Failed lifecycle', async () => {
  await writeRun('run-2b', [
    span({
      name: 'agent.run',
      spanId: 'a',
      status: { code: 0 },
      attributes: { 'agent.outcome': 'resource' },
    }),
  ]);
  const dto = await mapRunToDto(root, 'run-2b');
  expect(dto?.lifecycle).toBe(RunLifecycle.Failed);
  expect(dto?.spans[0]?.status).toBe(SpanStatus.Ok);
});

test('in-flight run (no agent.run span yet) → Running lifecycle', async () => {
  await writeRun('run-3', [
    span({
      name: 'agent.delegation',
      spanId: 'd',
      attributes: {
        'agent.delegation.target': 'researcher',
        'agent.delegation.depth': 1,
        'agent.delegation.ancestors': 'root → researcher',
      },
    }),
  ]);
  const dto = await mapRunToDto(root, 'run-3');
  expect(dto?.lifecycle).toBe(RunLifecycle.Running);
  expect(dto?.durationMs).toBe(0);
  expect(dto?.outcome).toBe('unknown');
  expect(dto?.spans[0]?.agent).toBe('researcher');
  expect(dto?.spans[0]?.delegation).toEqual({
    target: 'researcher',
    depth: 1,
    ancestors: ['root', 'researcher'],
  });
});

test('degrades come from degradation.jsonl and set degraded=true', async () => {
  await writeRun('run-4', [span({ name: 'agent.run', spanId: 'a' })], {
    degradation: `${JSON.stringify({ kind: 'tool_skipped', subject: 'voice', reason: 'no audio' })}\n`,
  });
  const dto = await mapRunToDto(root, 'run-4');
  expect(dto?.degraded).toBe(true);
  expect(dto?.degrades[0]).toMatchObject({
    kind: 'tool_skipped',
    subject: 'voice',
    label: expect.any(String),
  });
  // No spanId is persisted on disk — the DTO leaves it unset.
  expect(dto?.degrades[0]?.spanId).toBeUndefined();
});

test('per-span reliability.degrade event sets span.degraded=true', async () => {
  await writeRun('run-4b', [
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
  const dto = await mapRunToDto(root, 'run-4b');
  expect(dto?.spans[0]?.degraded).toBe(true);
  expect(dto?.spans[0]?.events[0]?.name).toBe('reliability.degrade');
  expect(dto?.spans[0]?.events[0]?.offsetMs).toBe(0);
});

test('undefined for a run with no spans; malformed lines are counted', async () => {
  expect(await mapRunToDto(root, 'missing')).toBeUndefined();
  const dir = join(root, 'run-5');
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, 'spans.jsonl'),
    `${JSON.stringify(span({ name: 'agent.run', spanId: 'a' }))}\nNOT JSON\n`,
  );
  const dto = await mapRunToDto(root, 'run-5');
  expect(dto?.malformedSpans).toBe(1);
  expect(dto?.spanCount).toBe(1);
});

test('JSON-valid but wrong-shaped span line ({}) is isolated as malformed, not thrown', async () => {
  const dir = join(root, 'run-badshape');
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, 'spans.jsonl'),
    [
      JSON.stringify(
        span({
          name: 'agent.run',
          spanId: 'a',
          attributes: { 'agent.outcome': 'answer' },
        }),
      ),
      '{}', // valid JSON, wrong shape — must NOT throw a TypeError in the mapper
      JSON.stringify(span({ name: 'x', spanId: 'b', parentSpanId: 'a' })),
      '',
    ].join('\n'),
  );
  const dto = await mapRunToDto(root, 'run-badshape');
  expect(dto).toBeDefined();
  // The two well-formed spans still map; the `{}` line is counted, not fatal.
  expect(dto?.malformedSpans).toBe(1);
  expect(dto?.spanCount).toBe(2);
  expect(dto?.spans.map((s) => s.spanId).sort()).toEqual(['a', 'b']);
  // Validates cleanly through the terminal schema.
  RunDtoSchema.parse(dto);
});

test('artifacts are wired in from the run dir', async () => {
  const dir = await writeRun('run-6', [
    span({ name: 'agent.run', spanId: 'a' }),
  ]);
  await writeFile(join(dir, 'answer.txt'), 'hello');
  const dto = await mapRunToDto(root, 'run-6');
  const names = dto?.artifacts.map((a) => a.name) ?? [];
  expect(names).toContain('answer.txt');
  expect(names).toContain('spans.jsonl');
});

test('completed crew.run root (no agent.run) → Done, non-zero duration, outcome', async () => {
  await writeRun('run-crew', [
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
  const dto = await mapRunToDto(root, 'run-crew');
  expect(dto?.lifecycle).toBe(RunLifecycle.Done);
  expect(dto?.durationMs).toBe(42);
  expect(dto?.outcome).toBe('answer');
  expect(dto?.roots).toEqual(['c']);
});

test('completed workflow.run root → Done, non-zero duration, outcome', async () => {
  await writeRun('run-wf', [
    span({
      name: 'workflow.run',
      spanId: 'w',
      startUnixNano: 3_000_000_000,
      durationMs: 33,
      attributes: { 'workflow.id': 'pipeline', 'agent.outcome': 'answer' },
    }),
    span({
      name: 'workflow.step',
      spanId: 's1',
      parentSpanId: 'w',
      startUnixNano: 3_002_000_000,
      durationMs: 10,
    }),
  ]);
  const dto = await mapRunToDto(root, 'run-wf');
  expect(dto?.lifecycle).toBe(RunLifecycle.Done);
  expect(dto?.durationMs).toBe(33);
  expect(dto?.outcome).toBe('answer');
});

test('crew.run root with resource outcome → Failed lifecycle', async () => {
  await writeRun('run-crew-fail', [
    span({
      name: 'crew.run',
      spanId: 'c',
      durationMs: 12,
      attributes: { 'crew.id': 'writers', 'agent.outcome': 'resource' },
    }),
  ]);
  const dto = await mapRunToDto(root, 'run-crew-fail');
  expect(dto?.lifecycle).toBe(RunLifecycle.Failed);
  expect(dto?.outcome).toBe('resource');
});

test('in-flight crew/workflow run (no recorded run-root span yet) → Running', async () => {
  await writeRun('run-crew-inflight', [
    span({
      name: 'workflow.step',
      spanId: 's1',
      startUnixNano: 4_000_000_000,
      durationMs: 5,
      attributes: { 'workflow.step.id': 'draft' },
    }),
  ]);
  const dto = await mapRunToDto(root, 'run-crew-inflight');
  expect(dto?.lifecycle).toBe(RunLifecycle.Running);
  expect(dto?.durationMs).toBe(0);
  expect(dto?.outcome).toBe('unknown');
});

test('schema-invalid degrade line is skipped; run still maps + validates', async () => {
  await writeRun(
    'run-bad-degrade',
    [span({ name: 'agent.run', spanId: 'a' })],
    {
      degradation: [
        // Valid JSON but fails DegradeDtoSchema (missing required `reason`).
        JSON.stringify({ kind: 'tool_skipped', subject: 'voice' }),
        // Valid JSON, unknown kind — also fails the schema.
        JSON.stringify({ kind: 'bogus_kind', subject: 'x', reason: 'y' }),
        // Fully valid entry.
        JSON.stringify({
          kind: 'retried',
          subject: 'model',
          reason: 'timeout',
          attempts: 2,
        }),
        '',
      ].join('\n'),
    },
  );
  const dto = await mapRunToDto(root, 'run-bad-degrade');
  expect(dto).toBeDefined();
  // Does not throw through the terminal RunDtoSchema.parse.
  const parsed = RunDtoSchema.parse(dto);
  expect(parsed.degrades).toHaveLength(1);
  expect(parsed.degrades[0]).toMatchObject({
    kind: 'retried',
    subject: 'model',
    reason: 'timeout',
    attempts: 2,
  });
  expect(parsed.degraded).toBe(true);
});

test('run tokens sum across multiple gen spans; token-less spans omit tokens', async () => {
  await writeRun('run-7', [
    span({ name: 'agent.run', spanId: 'a', startUnixNano: 0 }),
    span({
      name: 'ai.generateText',
      spanId: 'b',
      parentSpanId: 'a',
      startUnixNano: 100,
      attributes: {
        'gen_ai.request.model': 'm1',
        'gen_ai.usage.input_tokens': 10,
        'gen_ai.usage.output_tokens': 5,
      },
    }),
    span({
      name: 'ai.generateText',
      spanId: 'c',
      parentSpanId: 'a',
      startUnixNano: 200,
      attributes: {
        'gen_ai.request.model': 'm2',
        'gen_ai.usage.input_tokens': 3,
        'gen_ai.usage.output_tokens': 7,
      },
    }),
  ]);
  const dto = await mapRunToDto(root, 'run-7');
  expect(dto?.tokens).toEqual({ input: 13, output: 12 });
  expect(dto?.models).toEqual(['m1', 'm2']);
  expect(dto?.spans.find((s) => s.spanId === 'a')?.tokens).toBeUndefined();
});
