import { describe, expect, it } from 'bun:test';
import type { AgentProposal } from '../../src/agent-builder/types.ts';
import { validateProposal } from '../../src/agent-builder/validate.ts';
import { Capability, PreferPolicy } from '../../src/core/types.ts';

const base: AgentProposal = {
  name: 'pdf_qa',
  description: 'Answers questions about PDF files.',
  systemPrompt: 'You answer questions about a PDF.',
  modelReq: {
    role: 'pdf reasoning',
    requires: [Capability.Tools],
    prefer: PreferPolicy.LargestThatFits,
  },
  suggestedServers: [{ packName: 'filesystem', scopeToAgent: 'pdf_qa' }],
  rationale: 'No agent reads PDFs.',
};
const existing = ['file_qa', 'web_fetch'];
const pack = ['file-tools', 'filesystem', 'fetch'];

describe('validateProposal', () => {
  it('accepts a clean proposal', () => {
    expect(validateProposal(base, existing, pack)).toEqual([]);
  });
  it('rejects a duplicate name', () => {
    const issues = validateProposal(
      { ...base, name: 'file_qa' },
      existing,
      pack,
    );
    expect(issues.some((i) => i.field === 'name')).toBe(true);
  });
  it('rejects reserved names', () => {
    expect(
      validateProposal({ ...base, name: 'super' }, existing, pack).some(
        (i) => i.field === 'name',
      ),
    ).toBe(true);
  });
  it('rejects non-snake_case names', () => {
    expect(
      validateProposal({ ...base, name: 'PdfQA' }, existing, pack).some(
        (i) => i.field === 'name',
      ),
    ).toBe(true);
  });
  it('rejects empty description and systemPrompt', () => {
    expect(
      validateProposal({ ...base, description: '  ' }, existing, pack).some(
        (i) => i.field === 'description',
      ),
    ).toBe(true);
    expect(
      validateProposal({ ...base, systemPrompt: '' }, existing, pack).some(
        (i) => i.field === 'systemPrompt',
      ),
    ).toBe(true);
  });
  it('rejects an off-palette server (least-privilege)', () => {
    const issues = validateProposal(
      {
        ...base,
        suggestedServers: [{ packName: 'evil-server', scopeToAgent: 'pdf_qa' }],
      },
      existing,
      pack,
    );
    expect(issues.some((i) => i.field === 'suggestedServers')).toBe(true);
  });
  it('rejects a mis-scoped server', () => {
    const issues = validateProposal(
      {
        ...base,
        suggestedServers: [{ packName: 'filesystem', scopeToAgent: 'other' }],
      },
      existing,
      pack,
    );
    expect(issues.some((i) => i.field === 'suggestedServers')).toBe(true);
  });
});
