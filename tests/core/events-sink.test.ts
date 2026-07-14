import { describe, expect, it } from 'bun:test';
import type { StatusEvent } from '../../src/contracts/index.ts';
import { StatusEventType } from '../../src/contracts/index.ts';
import type { Agent } from '../../src/core/agent-def.ts';
import { runGuardedAgent } from '../../src/core/delegate.ts';

// A stub agent whose model is never called because the depth guard aborts it
// is not what we want here; instead assert the Delegation event fires on entry.
const fakeAgent: Agent = {
  name: 'file_qa',
  description: 'answers file questions',
  model: {} as never,
  systemPrompt: 'x',
  tools: {},
};

describe('events sink — delegation', () => {
  it('emits a Delegation event when a guarded agent starts', async () => {
    const seen: StatusEvent[] = [];
    // model call will throw (empty stub) → we only assert the Delegation event fired first.
    await runGuardedAgent(
      fakeAgent,
      'task',
      undefined,
      undefined,
      undefined,
      undefined,
      (e) => seen.push(e),
    ).catch(() => {});
    const delegation = seen.find((e) => e.type === StatusEventType.Delegation);
    expect(delegation).toMatchObject({
      type: 'data-delegation',
      agent: 'file_qa',
      depth: expect.any(Number),
      ancestors: expect.any(Array),
    });
  });
});
