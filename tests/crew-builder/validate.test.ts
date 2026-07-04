import { expect, test } from 'bun:test';
import type { BuilderModel } from '../../src/agent-builder/types.ts';
import { CrewProcess } from '../../src/crew/types.ts';
import type { CrewIR, WorkflowIR } from '../../src/crew-builder/ir.ts';
import { validateIR } from '../../src/crew-builder/validate.ts';

const okJudge: BuilderModel = {
  object: async () => ({ aligned: true, reason: 'ok' }) as never,
  text: async () => '',
};

test('flags a fromStep ref that names no upstream step (structural)', async () => {
  const ir: WorkflowIR = {
    id: 'w',
    steps: [
      {
        kind: 'agent',
        id: 'a',
        agent: 'web_fetch',
        input: { kind: 'fromStep', ref: 'ghost' },
      },
    ],
  };
  const issues = await validateIR(ir, 'workflow', {
    existingAgents: ['web_fetch'],
    packNames: [],
    toBeBuilt: [],
    model: okJudge,
  });
  expect(issues.some((i) => i.problem.includes('ghost'))).toBe(true);
});

test('flags an agent step referencing an unknown agent', async () => {
  const ir: WorkflowIR = {
    id: 'w',
    steps: [
      { kind: 'agent', id: 'a', agent: 'nope', input: { kind: 'fromInput' } },
    ],
  };
  const issues = await validateIR(ir, 'workflow', {
    existingAgents: ['web_fetch'],
    packNames: [],
    toBeBuilt: [],
    model: okJudge,
  });
  expect(issues.some((i) => i.field === 'agent')).toBe(true);
});

test('passes a valid workflow (agent known, ref resolves, goal aligned)', async () => {
  const ir: WorkflowIR = {
    id: 'w',
    steps: [
      { kind: 'tool', id: 'f', tool: 'fetch', input: { kind: 'fromInput' } },
      {
        kind: 'agent',
        id: 'a',
        agent: 'web_fetch',
        dependsOn: ['f'],
        input: { kind: 'fromStep', ref: 'f' },
      },
    ],
  };
  const issues = await validateIR(ir, 'workflow', {
    existingAgents: ['web_fetch'],
    packNames: ['fetch'],
    toBeBuilt: [],
    model: okJudge,
  });
  expect(issues).toEqual([]);
});

test('flags a map sub-step referencing an unknown agent', async () => {
  const ir: WorkflowIR = {
    id: 'w',
    steps: [
      {
        kind: 'map',
        id: 'm',
        over: { kind: 'mapOver', ref: 'f' },
        step: {
          kind: 'agent',
          agent: 'ghost_agent',
          input: { kind: 'fromInput' },
        },
      },
    ],
  };
  const issues = await validateIR(ir, 'workflow', {
    existingAgents: ['web_fetch'],
    packNames: [],
    toBeBuilt: [],
    model: okJudge,
  });
  expect(
    issues.some(
      (i) => i.field === 'agent' && i.problem.includes('ghost_agent'),
    ),
  ).toBe(true);
});

test('flags a fromTemplate placeholder that names no upstream step', async () => {
  const ir: WorkflowIR = {
    id: 'w',
    steps: [
      {
        kind: 'agent',
        id: 'a',
        agent: 'web_fetch',
        input: { kind: 'fromTemplate', template: 'x {{ghoststep}} y' },
      },
    ],
  };
  const issues = await validateIR(ir, 'workflow', {
    existingAgents: ['web_fetch'],
    packNames: [],
    toBeBuilt: [],
    model: okJudge,
  });
  expect(
    issues.some((i) => i.field === 'ref' && i.problem.includes('ghoststep')),
  ).toBe(true);
});

test('flags a malformed workflow id (not snake_case)', async () => {
  const ir: WorkflowIR = {
    id: 'my__flow',
    steps: [
      {
        kind: 'agent',
        id: 'a',
        agent: 'web_fetch',
        input: { kind: 'fromInput' },
      },
    ],
  };
  const issues = await validateIR(ir, 'workflow', {
    existingAgents: ['web_fetch'],
    packNames: [],
    toBeBuilt: [],
    model: okJudge,
  });
  expect(
    issues.some((i) => i.field === 'id' && i.problem.includes('my__flow')),
  ).toBe(true);
});

test('flags a malformed crew id (not snake_case)', async () => {
  const ir: CrewIR = {
    id: 'Bad Id',
    process: CrewProcess.Sequential,
    members: [
      {
        name: 'm',
        agentRef: 'web_fetch',
        role: 'Researcher',
        goal: 'research',
        backstory: 'a researcher',
        requires: ['tools'],
      },
    ],
    tasks: [
      {
        id: 't',
        description: 'do the thing',
        expectedOutput: 'the thing done',
        member: 'm',
      },
    ],
  };
  const issues = await validateIR(ir, 'crew', {
    existingAgents: ['web_fetch'],
    packNames: [],
    toBeBuilt: [],
    model: okJudge,
  });
  expect(
    issues.some((i) => i.field === 'id' && i.problem.includes('Bad Id')),
  ).toBe(true);
});

test('surfaces a goal-misaligned graph (semantic tier)', async () => {
  const noJudge: BuilderModel = {
    object: async () =>
      ({ aligned: false, reason: 'does not answer the need' }) as never,
    text: async () => '',
  };
  const ir: WorkflowIR = {
    id: 'w',
    steps: [
      {
        kind: 'agent',
        id: 'a',
        agent: 'web_fetch',
        input: { kind: 'fromInput' },
      },
    ],
  };
  const issues = await validateIR(ir, 'workflow', {
    existingAgents: ['web_fetch'],
    packNames: [],
    toBeBuilt: [],
    model: noJudge,
  });
  expect(issues.some((i) => i.field === 'goal-alignment')).toBe(true);
});
