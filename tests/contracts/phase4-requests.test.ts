import { expect, test } from 'bun:test';
import { RunKind } from '../../src/contracts/enums.ts';
import {
  CrewRunRequestSchema,
  RunLaunchResponseSchema,
  RunListQuerySchema,
  WorkflowListResponseSchema,
} from '../../src/contracts/requests.ts';

test('CrewRunRequestSchema requires an input string', () => {
  expect(CrewRunRequestSchema.parse({ input: 'AI' }).input).toBe('AI');
  expect(() => CrewRunRequestSchema.parse({})).toThrow();
});

test('RunLaunchResponseSchema carries the minted runId', () => {
  expect(RunLaunchResponseSchema.parse({ runId: 'flow-x' }).runId).toBe(
    'flow-x',
  );
});

test('RunListQuery accepts an optional kind facet', () => {
  expect(RunListQuerySchema.parse({ kind: RunKind.Crew }).kind).toBe(
    RunKind.Crew,
  );
  expect(RunListQuerySchema.parse({}).kind).toBeUndefined();
});

test('WorkflowListResponseSchema wraps items', () => {
  const r = WorkflowListResponseSchema.parse({
    items: [{ id: 'w', stepCount: 1 }],
  });
  expect(r.items).toHaveLength(1);
});
