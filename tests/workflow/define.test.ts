import { describe, expect, it } from 'bun:test';
import { z } from 'zod';
import { defineWorkflow } from '../../src/workflow/define.ts';
import { StepKind } from '../../src/workflow/types.ts';

const agent = (id: string, dependsOn?: string[]) => ({
  id,
  kind: StepKind.Agent as const,
  agent: 'web_fetch',
  input: () => 'hi',
  output: z.string(),
  ...(dependsOn ? { dependsOn } : {}),
});

describe('defineWorkflow', () => {
  it('accepts a valid linear workflow', () => {
    const def = defineWorkflow({ id: 'wf', steps: [agent('a'), agent('b')] });
    expect(def.steps).toHaveLength(2);
  });

  it('rejects duplicate step ids', () => {
    expect(() =>
      defineWorkflow({ id: 'wf', steps: [agent('a'), agent('a')] }),
    ).toThrow(/duplicate step id/i);
  });

  it('rejects an unknown dependsOn target', () => {
    expect(() =>
      defineWorkflow({ id: 'wf', steps: [agent('a'), agent('b', ['ghost'])] }),
    ).toThrow(/unknown.*ghost/i);
  });

  it('rejects an unknown branch target', () => {
    const branch = {
      id: 'br',
      kind: StepKind.Branch as const,
      predicate: () => true,
      whenTrue: 'a',
      whenFalse: 'ghost',
      output: z.object({ taken: z.string() }),
      dependsOn: [] as string[],
    };
    expect(() =>
      defineWorkflow({ id: 'wf', steps: [branch, agent('a', ['br'])] }),
    ).toThrow(/unknown.*ghost/i);
  });

  it('rejects a dependency cycle', () => {
    expect(() =>
      defineWorkflow({
        id: 'wf',
        steps: [agent('a', ['b']), agent('b', ['a'])],
      }),
    ).toThrow(/cycle/i);
  });
});
