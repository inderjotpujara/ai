import { expect, test } from 'bun:test';
import { RunDtoSchema, SpanDtoSchema } from '../../src/contracts/dto.ts';
import {
  ArtifactKind,
  DegradeKind,
  RunLifecycle,
  RunOrigin,
  SpanStatus,
} from '../../src/contracts/enums.ts';

const minimalSpan = {
  spanId: 's1',
  parentSpanId: null,
  name: 'agent.run',
  offsetMs: 0,
  durationMs: 12,
  depth: 0,
  status: SpanStatus.Ok,
  degraded: false,
  attributes: {},
  events: [],
};

test('SpanDTO parses with only required fields (forward-compat optionals absent)', () => {
  const parsed = SpanDtoSchema.parse(minimalSpan);
  expect(parsed.spanId).toBe('s1');
  expect(parsed.agent).toBeUndefined();
});

test('SpanDTO survives a JSON serialize/parse round-trip with optionals present', () => {
  const rich = {
    ...minimalSpan,
    statusMessage: 'ok',
    agent: 'researcher',
    delegation: { target: 'researcher', depth: 1, ancestors: ['router'] },
    model: {
      id: 'qwen3.5:4b',
      provider: 'ollama',
      numCtx: 8192,
      footprintBytes: 42,
      runtimeDegraded: false,
    },
    tokens: { input: 10, output: 20 },
    node: 'reserved-slice-31',
    attributes: { 'crew.id': 'x' },
    events: [{ name: 'agent.model.select', offsetMs: 3, attributes: { m: 1 } }],
  };
  const wire = JSON.parse(JSON.stringify(SpanDtoSchema.parse(rich)));
  expect(SpanDtoSchema.parse(wire)).toEqual(rich);
});

test('RunDTO parses with reserved owner + lifecycle + origin and nested spans', () => {
  const run = {
    id: 'run-123',
    owner: 'local',
    origin: RunOrigin.Manual,
    lifecycle: RunLifecycle.Done,
    startMs: 1000,
    durationMs: 50,
    outcome: 'answer',
    models: ['qwen3.5:4b'],
    degraded: true,
    degrades: [
      {
        kind: DegradeKind.Retried,
        label: 'retried',
        subject: 'ollama',
        reason: 'timeout',
        attempts: 2,
      },
    ],
    malformedSpans: 0,
    spanCount: 1,
    roots: ['s1'],
    spans: [minimalSpan],
    artifacts: [{ name: 'answer.txt', bytes: 12, kind: ArtifactKind.Answer }],
  };
  const parsed = RunDtoSchema.parse(run);
  expect(parsed.owner).toBe('local');
  expect(parsed.tokens).toBeUndefined();
  expect(parsed.degrades[0]?.kind).toBe(DegradeKind.Retried);
});

test('RunDTO rejects an unknown lifecycle value', () => {
  expect(() => RunDtoSchema.parse({ ...{}, lifecycle: 'exploded' })).toThrow();
});
