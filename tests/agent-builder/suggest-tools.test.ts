import { describe, expect, it } from 'bun:test';
import { suggestServers } from '../../src/agent-builder/suggest-tools.ts';
import type {
  AgentProposal,
  BuilderModel,
} from '../../src/agent-builder/types.ts';
import { Capability, PreferPolicy } from '../../src/core/types.ts';
import type { PackEntry } from '../../src/mcp/types.ts';

const proposal: AgentProposal = {
  name: 'pdf_qa',
  description: 'd',
  systemPrompt: 's',
  modelReq: {
    role: 'r',
    requires: [Capability.Tools],
    prefer: PreferPolicy.LargestThatFits,
  },
  suggestedServers: [],
  rationale: 'x',
};
const PACK: PackEntry[] = [
  {
    name: 'filesystem',
    description: 'files',
    capabilities: ['files'],
    server: {},
  },
  { name: 'fetch', description: 'http', capabilities: ['http'], server: {} },
];
const pick = (names: string[]): BuilderModel => ({
  object: async () => ({ servers: names }) as never,
  text: async () => '',
});

describe('suggestServers', () => {
  it('returns only pack names, scoped to the agent', async () => {
    const out = await suggestServers(
      'read files',
      proposal,
      pick(['filesystem']),
      PACK,
    );
    expect(out).toEqual([{ packName: 'filesystem', scopeToAgent: 'pdf_qa' }]);
  });
  it('drops names not in the pack (never invents a server)', async () => {
    const out = await suggestServers(
      'x',
      proposal,
      pick(['filesystem', 'evil']),
      PACK,
    );
    expect(out).toEqual([{ packName: 'filesystem', scopeToAgent: 'pdf_qa' }]);
  });
  it('dedupes repeats', async () => {
    const out = await suggestServers(
      'x',
      proposal,
      pick(['fetch', 'fetch']),
      PACK,
    );
    expect(out).toEqual([{ packName: 'fetch', scopeToAgent: 'pdf_qa' }]);
  });
  it('returns [] when the model picks nothing', async () => {
    expect(await suggestServers('x', proposal, pick([]), PACK)).toEqual([]);
  });
});
