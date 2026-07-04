import { describe, expect, it } from 'bun:test';
import type { ToolProposal } from '../../src/agent-builder/types.ts';
import { validateToolProposal } from '../../src/agent-builder/validate-tool.ts';

const base: ToolProposal = {
  name: 'word_count',
  description: 'Counts words in a string.',
  code: "import { tool } from 'ai';\nexport const wordCountTool = tool({});",
  rationale: 'No existing tool counts words.',
};
const existing = ['read_file'];

describe('validateToolProposal', () => {
  it('accepts a clean proposal', () => {
    expect(validateToolProposal(base, existing)).toEqual([]);
  });
  it('rejects a duplicate module name', () => {
    const issues = validateToolProposal(
      { ...base, name: 'read_file' },
      existing,
    );
    expect(issues.some((i) => i.field === 'name')).toBe(true);
  });
  it('rejects non-snake_case names', () => {
    expect(
      validateToolProposal({ ...base, name: 'WordCount' }, existing).some(
        (i) => i.field === 'name',
      ),
    ).toBe(true);
  });
  it('rejects empty description', () => {
    expect(
      validateToolProposal({ ...base, description: '  ' }, existing).some(
        (i) => i.field === 'description',
      ),
    ).toBe(true);
  });
  it('rejects empty code', () => {
    expect(
      validateToolProposal({ ...base, code: '' }, existing).some(
        (i) => i.field === 'code',
      ),
    ).toBe(true);
  });
  it('rejects code that does not define a tool()', () => {
    expect(
      validateToolProposal(
        { ...base, code: 'export const x = 1;' },
        existing,
      ).some((i) => i.field === 'code'),
    ).toBe(true);
  });
});
