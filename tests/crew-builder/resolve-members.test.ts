import { expect, test } from 'bun:test';
import type { WorkflowIR } from '../../src/crew-builder/ir.ts';
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
