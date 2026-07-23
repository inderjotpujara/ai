import { expect, test } from 'bun:test';
import type { Agent } from '../../src/core/agent-def.ts';
import type { CrewDef, CrewOutcome } from '../../src/crew/types.ts';
import { replayGoldenCase } from '../../src/self-improve/replay-case.ts';
import type { WorkflowDef, WorkflowOutcome } from '../../src/workflow/types.ts';

// Slice 32 Task-16 fix: the re-eval `runCase` must resolve a ref across ALL
// THREE registries (agents → crews → workflows) and dispatch to the matching
// run path — not only AGENTS (which made a drifted crew/workflow throw
// `unknown ... for re-eval` → terminal Failed). These unit tests exercise the
// shape-dispatch offline: `runCrew`/`runWorkflow` are injected fakes that
// assert they receive the right def + task (a live model isn't available here).

const fakeAgent = { name: 'a' } as unknown as Agent;
const crewDef = { id: 'my_crew' } as unknown as CrewDef;
const workflowDef = { id: 'my_wf' } as unknown as WorkflowDef;

test('resolves an AGENT ref and dispatches to the agent run path', async () => {
  const out = await replayGoldenCase('my_agent', 'task-in', {
    agents: { my_agent: () => fakeAgent },
    crews: {},
    workflows: {},
    runAgent: async (agent, input) => {
      expect(agent).toBe(fakeAgent);
      expect(input).toBe('task-in');
      return { text: 'agent-out' };
    },
    workflowAgentMap: () => ({}),
  });
  expect(out).toBe('agent-out');
});

test('resolves a CREW ref via fallback and dispatches to runCrew with the def + task', async () => {
  let seen: { def: unknown; input: unknown; tools: unknown } | undefined;
  const out = await replayGoldenCase('my_crew', 'crew-task', {
    agents: {},
    crews: { my_crew: crewDef },
    workflows: {},
    runAgent: async () => ({ text: 'unused' }),
    workflowAgentMap: () => ({}),
    runCrew: async (def, input, deps): Promise<CrewOutcome> => {
      seen = { def, input, tools: deps.tools };
      return { kind: 'done', output: 'crew-out' };
    },
  });
  expect(seen).toEqual({ def: crewDef, input: 'crew-task', tools: {} });
  expect(out).toBe('crew-out');
});

test('resolves a WORKFLOW ref via fallback and dispatches to runWorkflow with the def + task', async () => {
  let seen: { def: unknown; input: unknown } | undefined;
  const out = await replayGoldenCase('my_wf', 'wf-task', {
    agents: {},
    crews: {},
    workflows: { my_wf: workflowDef },
    runAgent: async () => ({ text: 'unused' }),
    workflowAgentMap: () => ({}),
    runWorkflow: async (def, input, deps): Promise<WorkflowOutcome> => {
      seen = { def, input };
      expect(typeof deps.runAgentStep).toBe('function');
      expect(deps.tools).toEqual({});
      return { kind: 'done', output: { result: 'wf-out' } };
    },
  });
  expect(seen).toEqual({ def: workflowDef, input: 'wf-task' });
  expect(out).toBe(JSON.stringify({ result: 'wf-out' }));
});

test('a crew failure returns its message (judge fails the case) rather than throwing', async () => {
  const out = await replayGoldenCase('my_crew', 't', {
    agents: {},
    crews: { my_crew: crewDef },
    workflows: {},
    runAgent: async () => ({ text: 'unused' }),
    workflowAgentMap: () => ({}),
    runCrew: async (): Promise<CrewOutcome> => ({
      kind: 'failed',
      message: 'boom',
    }),
  });
  expect(out).toBe('boom');
});

test('a truly-unknown ref throws a clear unknown-artifact error', async () => {
  await expect(
    replayGoldenCase('nope', 't', {
      agents: {},
      crews: {},
      workflows: {},
      runAgent: async () => ({ text: 'unused' }),
      workflowAgentMap: () => ({}),
    }),
  ).rejects.toThrow('unknown artifact for re-eval: nope');
});
