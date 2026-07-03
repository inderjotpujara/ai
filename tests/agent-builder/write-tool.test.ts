import { describe, expect, it } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ToolProposal } from '../../src/agent-builder/types.ts';
import { writeToolProposal } from '../../src/agent-builder/write-tool.ts';

const proposal: ToolProposal = {
  name: 'word_count',
  description: 'Counts words in a string.',
  code: "import { tool } from 'ai';\nexport const wordCountTool = tool({});",
  rationale: 'No existing tool counts words.',
};

describe('writeToolProposal', () => {
  it('writes a review-banner-prefixed file at <dir>/<name>.proposal.ts', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ab-write-tool-'));
    const file = writeToolProposal(proposal, dir);
    expect(file).toBe(join(dir, 'word_count.proposal.ts'));
    const content = await readFile(file, 'utf8');
    expect(content).toContain('PROPOSAL');
    expect(content).toContain('wordCountTool');
  });

  it('touches nothing else in the directory — no registry/index wiring', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ab-write-tool-'));
    writeToolProposal(proposal, dir);
    const files = await readdir(dir);
    expect(files).toEqual(['word_count.proposal.ts']);
  });

  it('rejects a name that does not match the snake_case pattern', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ab-write-tool-'));
    const bad: ToolProposal = { ...proposal, name: '../evil' };
    expect(() => writeToolProposal(bad, dir)).toThrow(/invalid tool name/);
    expect(existsSync(join(dir, '../evil.proposal.ts'))).toBe(false);
  });
});
