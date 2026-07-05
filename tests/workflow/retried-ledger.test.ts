import { describe, expect, it } from 'bun:test';
import { z } from 'zod';
import { createLedger, DegradeKind } from '../../src/reliability/ledger.ts';
import { runWorkflow } from '../../src/workflow/engine.ts';
import { StepKind } from '../../src/workflow/types.ts';

describe('workflow retry ledger visibility', () => {
  it('records a Retried event when a tool step succeeds only after retry', async () => {
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
    const ledger = createLedger();
    const outcome = await runWorkflow(
      def as never,
      {},
      {
        runAgentStep: async () => 'x',
        tools: { flaky: flakyTool } as never,
        ledger,
      },
    );
    expect(calls).toBe(2);
    expect(outcome.kind).toBe('done');
    const retried = ledger.events.find((e) => e.kind === DegradeKind.Retried);
    expect(retried).toBeDefined();
    expect(retried?.subject).toBe('tool:flaky');
  });
});
