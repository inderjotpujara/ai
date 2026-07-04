import { describe, expect, test } from 'bun:test';
import type {
  AgentProposal,
  BuilderModel,
} from '../../src/agent-builder/types.ts';
import { Capability, PreferPolicy } from '../../src/core/types.ts';
import { CrewProcess } from '../../src/crew/types.ts';
import type { CrewIR, WorkflowIR } from '../../src/crew-builder/ir.ts';
import {
  signatureFromIR,
  signatureFromNeed,
  signatureFromProposal,
  signatureText,
} from '../../src/verified-build/signature.ts';

const proposal: AgentProposal = {
  name: 'url_summarizer',
  description: 'Summarizes the content of URLs',
  systemPrompt: 'You summarize URLs.',
  modelReq: {
    role: 'url summarizer',
    requires: [Capability.Tools],
    prefer: PreferPolicy.LargestThatFits,
  },
  suggestedServers: [
    { packName: 'fetch', scopeToAgent: 'url_summarizer' },
    { packName: 'memory', scopeToAgent: 'url_summarizer' },
  ],
  rationale: 'Needed for link digests',
};

describe('signatureFromProposal', () => {
  test('maps description to purpose and suggested servers to tools', () => {
    const sig = signatureFromProposal(proposal);
    expect(sig.purpose).toBe('Summarizes the content of URLs');
    expect(sig.tools).toEqual(['fetch', 'memory']);
    expect(sig.roles).toEqual([]);
  });
});

describe('signatureFromIR', () => {
  test('crew: purpose from description, roles from members, tools unioned', () => {
    const crew: CrewIR = {
      id: 'research_crew',
      description: 'Researches a topic and writes a brief',
      process: CrewProcess.Sequential,
      members: [
        {
          name: 'researcher',
          role: 'researcher',
          goal: 'find facts',
          backstory: 'a researcher',
          requires: ['search'],
          tools: ['web_search'],
        },
        {
          name: 'writer',
          role: 'writer',
          goal: 'write brief',
          backstory: 'a writer',
          requires: ['writing'],
        },
      ],
      tasks: [
        {
          id: 'research',
          description: 'research the topic',
          expectedOutput: 'facts',
          member: 'researcher',
        },
      ],
    };
    const sig = signatureFromIR(crew, 'crew');
    expect(sig.purpose).toBe('Researches a topic and writes a brief');
    expect(sig.roles).toEqual(['researcher', 'writer']);
    expect(sig.tools).toEqual(['web_search']);
  });

  test('workflow: roles from step ids, tools from tool steps', () => {
    const workflow: WorkflowIR = {
      id: 'digest_flow',
      description: 'Builds a digest',
      steps: [
        {
          kind: 'tool',
          id: 'fetch',
          tool: 'web_fetch',
          input: { kind: 'fromInput' },
        },
        {
          kind: 'agent',
          id: 'summarize',
          agent: 'summarizer',
          dependsOn: ['fetch'],
          input: { kind: 'fromStep', ref: 'fetch' },
        },
      ],
    };
    const sig = signatureFromIR(workflow, 'workflow');
    expect(sig.purpose).toBe('Builds a digest');
    expect(sig.roles).toEqual(['fetch', 'summarize']);
    expect(sig.tools).toEqual(['web_fetch']);
  });

  test('missing description yields empty purpose', () => {
    const workflow: WorkflowIR = {
      id: 'bare',
      steps: [
        { kind: 'tool', id: 's1', tool: 't', input: { kind: 'fromInput' } },
      ],
    };
    expect(signatureFromIR(workflow, 'workflow').purpose).toBe('');
  });
});

describe('signatureFromNeed', () => {
  test('returns the model-distilled purpose with defaulted fields', async () => {
    const fake: BuilderModel = {
      object: async <T>() => ({ purpose: 'summarize urls', tools: [] }) as T,
      text: async () => '',
    };
    const sig = await signatureFromNeed('please summarize urls for me', fake);
    expect(sig.purpose).toBe('summarize urls');
    expect(sig.tools).toEqual([]);
    expect(sig.modelTier).toBe('');
    expect(sig.io).toBe('');
    expect(sig.roles).toEqual([]);
  });
});

describe('signatureText', () => {
  test('first line is the purpose', () => {
    const text = signatureText({
      purpose: 'Summarizes the content of URLs',
      tools: ['fetch'],
      modelTier: '',
      io: 'text in, text out',
      roles: ['summarizer'],
    });
    const lines = text.split('\n');
    expect(lines[0]).toBe('Summarizes the content of URLs');
    expect(lines[1]).toBe('tools: fetch');
    expect(lines[2]).toBe('io: text in, text out');
    expect(lines[3]).toBe('roles: summarizer');
  });
});
