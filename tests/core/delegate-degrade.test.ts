import { expect, test } from 'bun:test';
import { MockLanguageModelV3 } from 'ai/test';
import type { Agent } from '../../src/core/agent-def.ts';
import { runGuardedAgent } from '../../src/core/delegate.ts';
import { ProviderError } from '../../src/core/errors.ts';
import { createLedger, DegradeKind } from '../../src/reliability/ledger.ts';

/** Same construction shape as tests/core/delegate.test.ts's cannedAgent, but
 *  the model throws instead of returning text — simulates a dropped agent. */
function throwingAgent(name: string): Agent {
  return {
    name,
    description: `agent ${name}`,
    model: new MockLanguageModelV3({
      doGenerate: async () => {
        throw new ProviderError('mcp server down');
      },
    }),
    systemPrompt: 'test',
    tools: {},
  };
}

test('runGuardedAgent records a dropped-agent event and returns a structured error', async () => {
  const ledger = createLedger();
  const r = await runGuardedAgent(
    throwingAgent('pdf_agent'),
    'do it',
    undefined,
    undefined,
    ledger,
  );
  expect('error' in r).toBe(true);
  expect(ledger.events.some((e) => e.kind === DegradeKind.AgentDropped)).toBe(
    true,
  );
});
