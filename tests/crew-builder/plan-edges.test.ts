import { expect, test } from 'bun:test';
import type { BuilderModel } from '../../src/agent-builder/types.ts';
import type { WorkflowIR } from '../../src/crew-builder/ir.ts';
import { planEdges } from '../../src/crew-builder/plan-edges.ts';

const model = (obj: unknown): BuilderModel => ({
  object: async () => obj as never,
  text: async () => '',
});

test('assembles a valid workflow IR', async () => {
  const ir = (await planEdges(
    'x',
    'workflow',
    'a',
    {
      steps: [
        { id: 'fetch', kind: 'tool', tool: 'fetch' },
        { id: 'sum', kind: 'agent', agent: 'web_fetch' },
      ],
    },
    model({
      id: 'wf',
      steps: [
        {
          kind: 'tool',
          id: 'fetch',
          tool: 'fetch',
          input: { kind: 'fromInput' },
        },
        {
          kind: 'agent',
          id: 'sum',
          agent: 'web_fetch',
          dependsOn: ['fetch'],
          input: { kind: 'fromStep', ref: 'fetch' },
        },
      ],
    }),
  )) as WorkflowIR;
  expect(ir.steps.length).toBe(2);
});
