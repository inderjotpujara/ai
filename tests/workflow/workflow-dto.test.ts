import { expect, test } from 'bun:test';
import { z } from 'zod';
import { StepKind, type WorkflowDef } from '../../src/workflow/types.ts';
import {
  mapWorkflowToDetail,
  mapWorkflowToListItem,
} from '../../src/workflow/workflow-dto.ts';
import fetchThenSummarize from '../../workflows/fetch-then-summarize.ts';

test('mapWorkflowToListItem counts steps', () => {
  expect(mapWorkflowToListItem(fetchThenSummarize).stepCount).toBe(2);
});

test('mapWorkflowToDetail derives depends edges via effectiveDeps', () => {
  const detail = mapWorkflowToDetail(fetchThenSummarize);
  expect(detail.steps.map((s) => s.id)).toEqual(['fetch', 'summarize']);
  expect(detail.steps.find((s) => s.id === 'summarize')?.agent).toBe(
    'web_fetch',
  );
  expect(detail.edges).toEqual([
    { from: 'fetch', to: 'summarize', kind: 'depends' },
  ]);
});

test('implicit-linear deps: a step with no dependsOn links to the previous step', () => {
  const def: WorkflowDef = {
    id: 'lin',
    steps: [
      {
        id: 'a',
        kind: StepKind.Tool,
        dependsOn: [],
        tool: 't',
        input: () => ({}),
        output: z.unknown(),
      },
      {
        id: 'b',
        kind: StepKind.Agent,
        agent: 'x',
        input: () => 'y',
        output: z.string(),
      },
    ],
  };
  expect(mapWorkflowToDetail(def).edges).toEqual([
    { from: 'a', to: 'b', kind: 'depends' },
  ]);
});

test('branch steps emit branch-true / branch-false edges', () => {
  const def: WorkflowDef = {
    id: 'br',
    steps: [
      {
        id: 'gate',
        kind: StepKind.Branch,
        dependsOn: [],
        predicate: () => true,
        whenTrue: 'yes',
        whenFalse: 'no',
        output: z.unknown(),
      },
      {
        id: 'yes',
        kind: StepKind.Agent,
        dependsOn: ['gate'],
        agent: 'a',
        input: () => '',
        output: z.string(),
      },
      {
        id: 'no',
        kind: StepKind.Agent,
        dependsOn: ['gate'],
        agent: 'b',
        input: () => '',
        output: z.string(),
      },
    ],
  };
  const edges = mapWorkflowToDetail(def).edges;
  expect(edges).toContainEqual({
    from: 'gate',
    to: 'yes',
    kind: 'branch-true',
  });
  expect(edges).toContainEqual({
    from: 'gate',
    to: 'no',
    kind: 'branch-false',
  });
  const gate = mapWorkflowToDetail(def).steps.find((s) => s.id === 'gate');
  expect(gate?.branch).toEqual({ whenTrue: 'yes', whenFalse: 'no' });
});
