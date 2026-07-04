import { expect, test } from 'bun:test';
import { CrewProcess } from '../../src/crew/types.ts';
import type { CrewIR, WorkflowIR } from '../../src/crew-builder/ir.ts';
import { resolveMissingAgents } from '../../src/crew-builder/resolve-members.ts';

const wf = (agent: string): WorkflowIR => ({
  id: 'w',
  steps: [{ kind: 'agent', id: 'a', agent, input: { kind: 'fromInput' } }],
});

test('builds a missing agent and returns its name', async () => {
  const r = await resolveMissingAgents(wf('pdf_extractor'), 'workflow', {
    existingAgents: () => ['web_fetch'],
    buildMissingAgent: async () => 'pdf_extractor',
  } as never);
  expect(r.builtAgents).toEqual(['pdf_extractor']);
});

test('does not rebuild an existing agent', async () => {
  const r = await resolveMissingAgents(wf('web_fetch'), 'workflow', {
    existingAgents: () => ['web_fetch'],
    buildMissingAgent: async () => {
      throw new Error('should not be called');
    },
  } as never);
  expect(r.builtAgents).toEqual([]);
});

test('abandons when a required build is declined', async () => {
  const r = await resolveMissingAgents(wf('pdf_extractor'), 'workflow', {
    existingAgents: () => ['web_fetch'],
    buildMissingAgent: async () => null,
  } as never);
  expect(r.abandoned).toBeDefined();
});

test('collects a map step inner agent sub-step and builds it when missing', async () => {
  const ir: WorkflowIR = {
    id: 'w',
    steps: [
      {
        kind: 'map',
        id: 'm',
        over: { kind: 'mapOver', ref: 'input' },
        step: {
          kind: 'agent',
          agent: 'summarizer',
          input: { kind: 'fromInput' },
        },
      },
    ],
  };
  const built: string[] = [];
  const r = await resolveMissingAgents(ir, 'workflow', {
    existingAgents: () => ['web_fetch'],
    buildMissingAgent: async (need: string) => {
      built.push(need);
      return 'summarizer';
    },
  } as never);
  expect(r.builtAgents).toEqual(['summarizer']);
  expect(built.length).toBe(1);
});

test('rewrites the IR when the built agent name differs from the referenced name', async () => {
  const r = await resolveMissingAgents(wf('pdf_extractor'), 'workflow', {
    existingAgents: () => ['web_fetch'],
    buildMissingAgent: async () => 'pdf_reader',
  } as never);
  expect(r.builtAgents).toEqual(['pdf_reader']);
  const rewritten = r.ir as WorkflowIR;
  expect(rewritten.steps[0]).toMatchObject({ agent: 'pdf_reader' });
});

test('rewrites a map sub-step reference when the built agent name differs', async () => {
  const ir: WorkflowIR = {
    id: 'w',
    steps: [
      {
        kind: 'map',
        id: 'm',
        over: { kind: 'mapOver', ref: 'input' },
        step: {
          kind: 'agent',
          agent: 'summarizer',
          input: { kind: 'fromInput' },
        },
      },
    ],
  };
  const r = await resolveMissingAgents(ir, 'workflow', {
    existingAgents: () => ['web_fetch'],
    buildMissingAgent: async () => 'text_summarizer',
  } as never);
  expect(r.builtAgents).toEqual(['text_summarizer']);
  const rewritten = r.ir as WorkflowIR;
  const step = rewritten.steps[0];
  if (step?.kind !== 'map' || step.step.kind !== 'agent')
    throw new Error('expected a map step with an agent sub-step');
  expect(step.step.agent).toBe('text_summarizer');
});

const crew = (agentRef: string): CrewIR => ({
  id: 'c',
  process: CrewProcess.Sequential,
  members: [
    {
      name: 'extractor',
      agentRef,
      role: 'r',
      goal: 'g',
      backstory: 'b',
      requires: ['x'],
    },
  ],
  tasks: [
    {
      id: 't',
      description: 'd',
      expectedOutput: 'o',
      member: 'extractor',
    },
  ],
});

test('collects a crew member agentRef and builds it when missing', async () => {
  const built: string[] = [];
  const r = await resolveMissingAgents(crew('pdf_extractor'), 'crew', {
    existingAgents: () => ['web_fetch'],
    buildMissingAgent: async (need: string) => {
      built.push(need);
      return 'pdf_extractor';
    },
  } as never);
  expect(r.builtAgents).toEqual(['pdf_extractor']);
  expect(built.length).toBe(1);
});

test('rewrites a crew member agentRef when the built agent name differs, leaving member/task names untouched', async () => {
  const r = await resolveMissingAgents(crew('pdf_extractor'), 'crew', {
    existingAgents: () => ['web_fetch'],
    buildMissingAgent: async () => 'pdf_reader',
  } as never);
  expect(r.builtAgents).toEqual(['pdf_reader']);
  const rewritten = r.ir as CrewIR;
  const member = rewritten.members[0];
  const task = rewritten.tasks[0];
  if (!member || !task) throw new Error('expected a member and a task');
  expect(member.agentRef).toBe('pdf_reader');
  expect(member.name).toBe('extractor');
  expect(task.member).toBe('extractor');
});
