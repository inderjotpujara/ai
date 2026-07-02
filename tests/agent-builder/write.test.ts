import { describe, expect, it } from 'bun:test';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentProposal } from '../../src/agent-builder/types.ts';
import { pascalCase, writeAgent } from '../../src/agent-builder/write.ts';
import { Capability, PreferPolicy } from '../../src/core/types.ts';
import { getPackEntry } from '../../src/mcp/pack.ts';

const INDEX_SEED = `import type { ToolSet } from 'ai';
import type { Agent } from '../src/core/agent-def.ts';
import { createFileQaAgent } from './file-qa.ts';
// AGENT-BUILDER:IMPORTS (generated agent imports are inserted above this line — do not remove)
export type AgentFactory = (tools: ToolSet) => Agent;
export const AGENTS: Record<string, AgentFactory> = {
  file_qa: createFileQaAgent,
  // AGENT-BUILDER:ENTRIES (generated agent entries are inserted above this line — do not remove)
};
export function agentNames(): string[] { return Object.keys(AGENTS); }
`;

const proposal: AgentProposal = {
  name: 'pdf_qa',
  description: 'Answers questions about PDF files.',
  systemPrompt: 'You answer questions about a PDF using `read_file`.',
  modelReq: {
    role: 'pdf reasoning',
    requires: [Capability.Tools],
    prefer: PreferPolicy.LargestThatFits,
  },
  suggestedServers: [{ packName: 'filesystem', scopeToAgent: 'pdf_qa' }],
  rationale: 'No agent reads PDFs.',
};

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'ab-write-'));
  const agentsDir = join(dir, 'agents');
  const indexPath = join(agentsDir, 'index.ts');
  const mcpConfigPath = join(dir, 'mcp.json');
  await writeFile(join(dir, 'placeholder'), ''); // ensure dir exists chain
  await Bun.write(indexPath, INDEX_SEED);
  return { agentsDir, indexPath, mcpConfigPath };
}

describe('pascalCase', () => {
  it('converts snake_case to PascalCase', () => {
    expect(pascalCase('pdf_qa')).toBe('PdfQa');
    expect(pascalCase('web_fetch')).toBe('WebFetch');
  });
});

describe('writeAgent', () => {
  it('writes a parseable agent file with the right factory name', async () => {
    const paths = await setup();
    const files = writeAgent(proposal, paths);
    const agentFile = await readFile(
      join(paths.agentsDir, 'pdf_qa.ts'),
      'utf8',
    );
    expect(agentFile).toContain(
      'export function createPdfQaAgent(tools: ToolSet): Agent',
    );
    // name is emitted via JSON.stringify — double-quoted, safely escaped.
    expect(agentFile).toContain('name: "pdf_qa"');
    expect(agentFile).toContain('requires: [Capability.Tools]');
    expect(files).toContain(join(paths.agentsDir, 'pdf_qa.ts'));
  });
  it('rejects a name that does not match the snake_case pattern', async () => {
    const paths = await setup();
    const bad: AgentProposal = {
      ...proposal,
      name: '../evil',
    };
    expect(() => writeAgent(bad, paths)).toThrow(/invalid agent name/);
  });
  it('writing the same agent twice does not duplicate the index import/entry', async () => {
    const paths = await setup();
    writeAgent(proposal, paths);
    writeAgent(proposal, paths);
    const idx = await readFile(paths.indexPath, 'utf8');
    const importLine = "import { createPdfQaAgent } from './pdf_qa.ts';";
    const entryLine = 'pdf_qa: createPdfQaAgent,';
    expect(idx.split(importLine).length - 1).toBe(1);
    expect(idx.split(entryLine).length - 1).toBe(1);
  });
  it('throws if agents/index.ts is missing the AGENT-BUILDER markers, without corrupting it', async () => {
    const paths = await setup();
    const unmarked = 'export const AGENTS = {};\n';
    await Bun.write(paths.indexPath, unmarked);
    expect(() => writeAgent(proposal, paths)).toThrow(/AGENT-BUILDER markers/);
    const idx = await readFile(paths.indexPath, 'utf8');
    expect(idx).toBe(unmarked); // untouched, not silently corrupted
  });
  it('inserts import + entry into index.ts at the markers', async () => {
    const paths = await setup();
    writeAgent(proposal, paths);
    const idx = await readFile(paths.indexPath, 'utf8');
    expect(idx).toContain("import { createPdfQaAgent } from './pdf_qa.ts';");
    expect(idx).toContain('pdf_qa: createPdfQaAgent,');
    expect(idx.indexOf('createPdfQaAgent')).toBeLessThan(
      idx.indexOf('AGENT-BUILDER:IMPORTS'),
    );
  });
  it('writes a scoped mcp.json entry', async () => {
    const paths = await setup();
    writeAgent(proposal, paths);
    const cfg = JSON.parse(await readFile(paths.mcpConfigPath, 'utf8'));
    expect(cfg.mcpServers.filesystem).toBeDefined();
    expect(cfg.mcpServers.filesystem.agents).toContain('pdf_qa');
  });
  it('re-scopes an already-present server without clobbering it', async () => {
    const paths = await setup();
    await Bun.write(
      paths.mcpConfigPath,
      JSON.stringify({
        mcpServers: { filesystem: { command: 'x', agents: ['other'] } },
      }),
    );
    writeAgent(proposal, paths);
    const cfg = JSON.parse(await readFile(paths.mcpConfigPath, 'utf8'));
    expect(cfg.mcpServers.filesystem.command).toBe('x'); // preserved
    expect(cfg.mcpServers.filesystem.agents).toEqual(['other', 'pdf_qa']); // appended
  });
  it('does not mutate the shared STARTER_PACK entry when scoping a preset-agents pack (regression)', async () => {
    const paths = await setup();
    const before = structuredClone(getPackEntry('file-tools')?.server.agents);
    const packRegressionProposal: AgentProposal = {
      ...proposal,
      name: 'pack_regression_agent',
      suggestedServers: [
        { packName: 'file-tools', scopeToAgent: 'pack_regression_agent' },
      ],
    };
    writeAgent(packRegressionProposal, paths);
    expect(getPackEntry('file-tools')?.server.agents).toEqual(before);
  });
});
