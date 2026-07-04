import { expect, test } from 'bun:test';
import type { BuilderModel } from '../../src/agent-builder/types.ts';
import type { CrewIR, WorkflowIR } from '../../src/crew-builder/ir.ts';
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

test('assembles a valid crew IR', async () => {
  const ir = (await planEdges(
    'x',
    'crew',
    'a',
    {
      members: [
        {
          name: 'researcher',
          role: 'Researcher',
          goal: 'Find facts',
          backstory: 'Expert researcher',
          requires: ['tools'],
        },
      ],
    },
    model({
      id: 'crew1',
      process: 'sequential',
      members: [
        {
          name: 'researcher',
          role: 'Researcher',
          goal: 'Find facts',
          backstory: 'Expert researcher',
          requires: ['tools'],
        },
      ],
      tasks: [
        {
          id: 'research',
          description: 'Research the topic',
          expectedOutput: 'A summary of findings',
          member: 'researcher',
        },
      ],
    }),
  )) as CrewIR;
  expect(ir.id).toBe('crew1');
  expect(ir.members.map((m) => m.name)).toEqual(['researcher']);
});

test('rejects an invalid crew IR (missing process)', async () => {
  const promise = planEdges(
    'x',
    'crew',
    'a',
    {
      members: [
        {
          name: 'researcher',
          role: 'Researcher',
          goal: 'Find facts',
          backstory: 'Expert researcher',
          requires: ['tools'],
        },
      ],
    },
    model({
      id: 'crew1',
      members: [
        {
          name: 'researcher',
          role: 'Researcher',
          goal: 'Find facts',
          backstory: 'Expert researcher',
          requires: ['tools'],
        },
      ],
      tasks: [
        {
          id: 'research',
          description: 'Research the topic',
          expectedOutput: 'A summary of findings',
          member: 'researcher',
        },
      ],
    }),
  );
  await expect(promise).rejects.toThrow();
});

test('rejects an invalid workflow IR (missing input)', async () => {
  const promise = planEdges(
    'x',
    'workflow',
    'a',
    {
      steps: [{ id: 'fetch', kind: 'tool', tool: 'fetch' }],
    },
    model({
      id: 'wf',
      steps: [
        {
          kind: 'tool',
          id: 'fetch',
          tool: 'fetch',
        },
      ],
    }),
  );
  await expect(promise).rejects.toThrow();
});
