import { expect, test } from 'bun:test';
import { CrewProcess } from '../../src/crew/types.ts';
import type { CrewIR, WorkflowIR } from '../../src/crew-builder/ir.ts';
import { transpile } from '../../src/crew-builder/transpile.ts';

test('workflow transpile renders defineWorkflow + safe-helper calls', () => {
  const ir: WorkflowIR = {
    id: 'fetch_then_sum',
    description: 'd',
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
  };
  const src = transpile(ir, 'workflow');
  expect(src).toContain('export default defineWorkflow(');
  expect(src).toContain('kind: StepKind.Tool');
  expect(src).toContain('input: fromInput()');
  expect(src).toContain('input: fromStep("fetch")');
  expect(src).toContain('"fetch_then_sum"');
});

test('crew transpile renders defineCrew + members (inline + agentRef)', () => {
  const ir: CrewIR = {
    id: 'rc',
    process: CrewProcess.Sequential,
    members: [
      {
        name: 'researcher',
        role: 'r',
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
  const src = transpile(ir, 'crew');
  expect(src).toContain('export default defineCrew(');
  expect(src).toContain('CrewProcess.Sequential');
  expect(src).toContain('"researcher"');
});
