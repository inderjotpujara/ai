import { expect, test } from 'bun:test';
import {
  DegradeKind,
  ModelLoadAction,
  StatusEventType,
} from '../../src/contracts/enums.ts';
import { StatusEventSchema } from '../../src/contracts/events.ts';

test('parses a data-delegation event and discriminates on type', () => {
  const e = StatusEventSchema.parse({
    type: StatusEventType.Delegation,
    agent: 'researcher',
    depth: 1,
    parentAgent: 'router',
    ancestors: ['router'],
  });
  expect(e.type as string).toBe('data-delegation');
});

test('parses a data-model-load event with an enum action', () => {
  const e = StatusEventSchema.parse({
    type: StatusEventType.ModelLoad,
    model: 'qwen3.5:4b',
    action: ModelLoadAction.Warm,
  });
  if (e.type === StatusEventType.ModelLoad) {
    expect(e.action as string).toBe('warm');
  }
});

test('parses the bidirectional data-confirm ask', () => {
  const e = StatusEventSchema.parse({
    type: StatusEventType.Confirm,
    promptId: 'cap-abc123',
    kind: 'mcp-mount',
    question: 'Mount github MCP server?',
  });
  if (e.type === StatusEventType.Confirm) {
    expect(e.promptId).toBe('cap-abc123');
  }
});

test('data-degrade survives a JSON round-trip', () => {
  const src = {
    type: StatusEventType.Degrade as const,
    kind: DegradeKind.CircuitOpen as const,
    subject: 'ollama',
    reason: 'threshold hit',
    spanId: 's7',
  };
  const wire = JSON.parse(JSON.stringify(StatusEventSchema.parse(src)));
  expect(StatusEventSchema.parse(wire)).toEqual(src);
});

test('rejects an unknown event type', () => {
  expect(() => StatusEventSchema.parse({ type: 'data-nope' })).toThrow();
});
