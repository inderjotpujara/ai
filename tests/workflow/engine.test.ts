import { describe, expect, it } from 'bun:test';
import { z } from 'zod';
import { defineWorkflow } from '../../src/workflow/define.ts';
import { runWorkflow } from '../../src/workflow/engine.ts';
import type { WorkflowDeps } from '../../src/workflow/run-step.ts';
import { StepKind } from '../../src/workflow/types.ts';

const deps = (over: Partial<WorkflowDeps> = {}): WorkflowDeps => ({
  runAgentStep: async (_a, task) => task.toUpperCase(),
  tools: {},
  ...over,
});

describe('runWorkflow', () => {
  it('threads validated context through a linear chain', async () => {
    const def = defineWorkflow({
      id: 'chain',
      steps: [
        {
          id: 'a',
          kind: StepKind.Agent,
          agent: 'x',
          input: (ctx) => `hello ${ctx.input}`,
          output: z.string(),
        },
        {
          id: 'b',
          kind: StepKind.Agent,
          agent: 'x',
          input: (ctx) => `again ${ctx.a}`,
          output: z.string(),
        },
      ],
    });
    const out = await runWorkflow(def, 'world', deps());
    expect(out.kind).toBe('done');
    if (out.kind === 'done') {
      expect(out.output.a).toBe('HELLO WORLD');
      expect(out.output.b).toBe('AGAIN HELLO WORLD');
    }
  });

  it('fails the workflow when output schema validation fails', async () => {
    const def = defineWorkflow({
      id: 'badout',
      steps: [
        {
          id: 'a',
          kind: StepKind.Agent,
          agent: 'x',
          input: () => 'text',
          output: z.number(), // agent returns a string → invalid
        },
      ],
    });
    const out = await runWorkflow(def, null, deps());
    expect(out).toMatchObject({ kind: 'failed', failedStep: 'a' });
  });

  it('branch takes the correct arm and skips the dead arm + its descendants', async () => {
    const def = defineWorkflow({
      id: 'br',
      steps: [
        {
          id: 'gate',
          kind: StepKind.Branch,
          dependsOn: [],
          predicate: (ctx) => ctx.input === 'go',
          whenTrue: 'live',
          whenFalse: 'dead',
          output: z.object({ taken: z.string() }),
        },
        {
          id: 'live',
          kind: StepKind.Agent,
          agent: 'x',
          dependsOn: ['gate'],
          input: () => 'live',
          output: z.string(),
        },
        {
          id: 'dead',
          kind: StepKind.Agent,
          agent: 'x',
          dependsOn: ['gate'],
          input: () => 'dead',
          output: z.string(),
        },
      ],
    });
    const out = await runWorkflow(def, 'go', deps());
    expect(out.kind).toBe('done');
    if (out.kind === 'done') {
      expect(out.output.live).toBe('LIVE');
      expect('dead' in out.output).toBe(false);
    }
  });

  it('onError "continue" skips dependents; {fallback} substitutes', async () => {
    const failingDeps = deps({
      runAgentStep: async (_a, task) => {
        if (task === 'boom') throw new Error('kaboom');
        return task;
      },
    });
    const def = defineWorkflow({
      id: 'resil',
      steps: [
        {
          id: 'a',
          kind: StepKind.Agent,
          agent: 'x',
          input: () => 'boom',
          output: z.string(),
          onError: { fallback: 'SAFE' },
        },
        {
          id: 'b',
          kind: StepKind.Agent,
          agent: 'x',
          input: (ctx) => `got ${ctx.a}`,
          output: z.string(),
        },
      ],
    });
    const out = await runWorkflow(def, null, failingDeps);
    expect(out.kind).toBe('done');
    if (out.kind === 'done') {
      expect(out.output.a).toBe('SAFE');
      expect(out.output.b).toBe('got SAFE');
    }
  });

  it('map fans out and collects validated results', async () => {
    const def = defineWorkflow({
      id: 'mapwf',
      steps: [
        {
          id: 'm',
          kind: StepKind.Map,
          dependsOn: [],
          over: (ctx) => ctx.input as string[],
          step: {
            kind: StepKind.Agent,
            agent: 'x',
            input: (ctx) => String(ctx.item),
            output: z.string(),
          },
          output: z.array(z.string()),
        },
      ],
    });
    const out = await runWorkflow(def, ['a', 'b'], deps());
    expect(out.kind).toBe('done');
    if (out.kind === 'done') expect(out.output.m).toEqual(['A', 'B']);
  });
});
