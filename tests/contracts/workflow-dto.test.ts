import { expect, test } from 'bun:test';
import {
  WorkflowDetailDtoSchema,
  WorkflowListItemDtoSchema,
} from '../../src/contracts/dto.ts';
import { StepKind } from '../../src/contracts/enums.ts';

test('WorkflowListItemDtoSchema accepts a summary', () => {
  const item = WorkflowListItemDtoSchema.parse({
    id: 'fetch-then-summarize',
    description: 'Fetch then summarize',
    stepCount: 2,
  });
  expect(item.stepCount).toBe(2);
});

test('WorkflowDetailDtoSchema carries steps + typed edges', () => {
  const detail = WorkflowDetailDtoSchema.parse({
    id: 'fetch-then-summarize',
    steps: [
      { id: 'fetch', kind: StepKind.Tool, tool: 'fetch' },
      { id: 'summarize', kind: StepKind.Agent, agent: 'web_fetch' },
    ],
    edges: [{ from: 'fetch', to: 'summarize', kind: 'depends' }],
  });
  expect(detail.edges[0]?.kind).toBe('depends');
  expect(detail.steps[1]?.agent).toBe('web_fetch');
});
