import { expect, test } from 'bun:test';
import {
  ChatMessageDtoSchema,
  RunDtoSchema,
  RunListItemDtoSchema,
  SpanDtoSchema,
} from '../../src/contracts/dto.ts';
import {
  ArtifactKind,
  ChatRole,
  DegradeKind,
  RunKind,
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

const validRun = {
  id: 'run-123',
  owner: 'local',
  origin: RunOrigin.Manual,
  kind: RunKind.Agent,
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

test('RunDTO parses with reserved owner + lifecycle + origin and nested spans', () => {
  const parsed = RunDtoSchema.parse(validRun);
  expect(parsed.owner).toBe('local');
  expect(parsed.tokens).toBeUndefined();
  expect(parsed.degrades[0]?.kind).toBe(DegradeKind.Retried);
});

test('RunDTO rejects an unknown lifecycle value', () => {
  const invalidRun = { ...validRun, lifecycle: 'exploded' };
  expect(() => RunDtoSchema.parse(invalidRun)).toThrow();
});

test('ChatMessageDTO parses a valid message with the optional degraded flag', () => {
  const parsed = ChatMessageDtoSchema.parse({
    id: 'm1',
    role: ChatRole.Assistant,
    text: 'hello there',
    degraded: true,
  });
  expect(parsed.id).toBe('m1');
  expect(parsed.role).toBe(ChatRole.Assistant);
  expect(parsed.text).toBe('hello there');
  expect(parsed.degraded).toBe(true);
});

test('ChatMessageDTO parses with degraded absent (forward-compat optional)', () => {
  const parsed = ChatMessageDtoSchema.parse({
    id: 'm2',
    role: ChatRole.User,
    text: 'hi',
  });
  expect(parsed.degraded).toBeUndefined();
});

test('ChatMessageDTO rejects a message missing text', () => {
  expect(() =>
    ChatMessageDtoSchema.parse({ id: 'm3', role: ChatRole.User }),
  ).toThrow();
});

test('ChatMessageDTO rejects an unknown role', () => {
  expect(() =>
    ChatMessageDtoSchema.parse({ id: 'm4', role: 'narrator', text: 'x' }),
  ).toThrow();
});

test('RunListItemDTO parses a minimal summary (tokens optional, no spans/artifacts)', () => {
  const parsed = RunListItemDtoSchema.parse({
    id: 'run-1',
    startMs: 1000,
    durationMs: 42,
    outcome: 'answer',
    lifecycle: RunLifecycle.Done,
    origin: RunOrigin.Manual,
    kind: RunKind.Agent,
    models: ['qwen3.5:9b'],
    degraded: false,
    spanCount: 7,
  });
  expect(parsed.tokens).toBeUndefined();
  expect(parsed.models).toEqual(['qwen3.5:9b']);
  // The list DTO deliberately carries no heavy arrays.
  expect('spans' in parsed).toBe(false);
  expect('artifacts' in parsed).toBe(false);
});

test('RunListItemDTO round-trips with a token roll-up present', () => {
  const parsed = RunListItemDtoSchema.parse({
    id: 'run-2',
    startMs: 0,
    durationMs: 0,
    outcome: 'unknown',
    lifecycle: RunLifecycle.Running,
    origin: RunOrigin.Manual,
    kind: RunKind.Chat,
    models: [],
    degraded: true,
    spanCount: 0,
    tokens: { input: 12, output: 8 },
  });
  expect(parsed.tokens).toEqual({ input: 12, output: 8 });
});
