import { expect, test } from 'bun:test';
import { MockLanguageModelV3 } from 'ai/test';
import type { Agent } from '../../src/core/agent-def.ts';
import { createOrchestrator } from '../../src/core/orchestrator.ts';
import { createLedger } from '../../src/reliability/ledger.ts';

// A minimal sub-agent; we only need createOrchestrator to accept + wire the
// ledger without throwing. End-to-end drop recording is covered by the
// delegate test (Task 13) and the live-verify gate (Task 21).
function subAgent(name: string): Agent {
  return {
    name,
    description: `handles ${name} tasks`,
    model: new MockLanguageModelV3({
      doGenerate: async () => {
        throw new Error('not called in this test');
      },
    }),
    systemPrompt: 'sub',
    tools: {},
  };
}

test('createOrchestrator accepts a ledger and wires it to delegate tools', () => {
  const ledger = createLedger();
  const agent = subAgent('file_qa');
  const orch = createOrchestrator({
    model: new MockLanguageModelV3({
      doGenerate: async () => {
        throw new Error('not called in this test');
      },
    }),
    systemPrompt: 'route',
    agents: [agent],
    ledger,
  });
  expect(orch).toBeDefined();
  expect(orch.tools[`delegate_to_${agent.name}`]).toBeDefined();
});
