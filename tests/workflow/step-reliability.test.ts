import { beforeEach, describe, expect, it } from 'bun:test';
import { z } from 'zod';
import { resetBreakers } from '../../src/reliability/breaker.ts';
import { runWorkflow } from '../../src/workflow/engine.ts';
import { StepKind } from '../../src/workflow/types.ts';

describe('workflow step reliability', () => {
  beforeEach(() => resetBreakers());

  it('retries a Transient tool failure then continues', async () => {
    let calls = 0;
    const flakyTool = {
      description: 'flaky',
      inputSchema: z.object({}),
      execute: async () => {
        calls++;
        if (calls < 2)
          throw Object.assign(new Error('reset'), { code: 'ECONNRESET' });
        return 'ok';
      },
    };
    const def = {
      id: 'wf',
      steps: [
        {
          id: 's1',
          kind: StepKind.Tool,
          tool: 'flaky',
          input: () => ({}),
          output: z.any(),
          retry: true,
        },
      ],
    };
    const outcome = await runWorkflow(
      def as never,
      {},
      {
        runAgentStep: async () => 'x',
        tools: { flaky: flakyTool } as never,
      },
    );
    expect(calls).toBe(2);
    expect(outcome.kind).toBe('done');
  });
});
