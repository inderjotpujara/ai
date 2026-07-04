import { expect, test } from 'bun:test';
import { CrewIRSchema, WorkflowIRSchema } from '../../src/crew-builder/ir.ts';

test('WorkflowIRSchema accepts a valid agent+tool+branch graph', () => {
  const ir = {
    id: 'fetch_and_check',
    description: 'fetch then branch',
    steps: [
      {
        kind: 'tool',
        id: 'fetch',
        tool: 'fetch',
        input: { kind: 'fromInput' },
      },
      {
        kind: 'agent',
        id: 'summarize',
        agent: 'web_fetch',
        dependsOn: ['fetch'],
        input: { kind: 'fromStep', ref: 'fetch' },
      },
      {
        kind: 'branch',
        id: 'ok',
        dependsOn: ['summarize'],
        predicate: { kind: 'whenContains', ref: 'summarize', substr: 'error' },
        whenTrue: 'summarize',
        whenFalse: 'summarize',
      },
    ],
  };
  expect(WorkflowIRSchema.safeParse(ir).success).toBe(true);
});

test('CrewIRSchema accepts inline + agentRef members', () => {
  const ir = {
    id: 'research_crew',
    description: 'x',
    process: 'sequential',
    members: [
      {
        name: 'researcher',
        role: 'r',
        goal: 'g',
        backstory: 'b',
        requires: ['tools'],
      },
      {
        name: 'web_fetch',
        agentRef: 'web_fetch',
        role: 'fetcher',
        goal: 'g',
        backstory: 'b',
        requires: ['tools'],
      },
    ],
    tasks: [
      {
        id: 'gather',
        description: 'd',
        expectedOutput: 'o',
        member: 'researcher',
      },
    ],
  };
  expect(CrewIRSchema.safeParse(ir).success).toBe(true);
});

test('WorkflowIRSchema rejects an unknown step kind', () => {
  expect(
    WorkflowIRSchema.safeParse({ id: 'x', steps: [{ kind: 'nope', id: 'a' }] })
      .success,
  ).toBe(false);
});

test('WorkflowIRSchema accepts a valid map step', () => {
  const ir = {
    id: 'fetch_each',
    steps: [
      {
        kind: 'tool',
        id: 'list',
        tool: 'list_urls',
        input: { kind: 'fromInput' },
      },
      {
        kind: 'map',
        id: 'each',
        dependsOn: ['list'],
        over: { kind: 'mapOver', ref: 'list' },
        step: {
          kind: 'agent',
          agent: 'web_fetch',
          input: { kind: 'fromInput' },
        },
      },
    ],
  };
  expect(WorkflowIRSchema.safeParse(ir).success).toBe(true);
});

test('WorkflowIRSchema rejects a map step missing its required step field', () => {
  const ir = {
    id: 'fetch_each',
    steps: [
      {
        kind: 'tool',
        id: 'list',
        tool: 'list_urls',
        input: { kind: 'fromInput' },
      },
      {
        kind: 'map',
        id: 'each',
        dependsOn: ['list'],
        over: { kind: 'mapOver', ref: 'list' },
      },
    ],
  };
  expect(WorkflowIRSchema.safeParse(ir).success).toBe(false);
});
