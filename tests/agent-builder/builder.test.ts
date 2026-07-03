import { describe, expect, it } from 'bun:test';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildAgent } from '../../src/agent-builder/builder.ts';
import type {
  BuilderDeps,
  BuilderModel,
} from '../../src/agent-builder/types.ts';

const INDEX_SEED = `import type { ToolSet } from 'ai';
import type { Agent } from '../src/core/agent-def.ts';
// AGENT-BUILDER:IMPORTS (generated agent imports are inserted above this line — do not remove)
export type AgentFactory = (tools: ToolSet) => Agent;
export const AGENTS: Record<string, AgentFactory> = {
  // AGENT-BUILDER:ENTRIES (generated agent entries are inserted above this line — do not remove)
};
`;

// A model that returns a draft for the first call and a server pick for the second.
function twoStepModel(serverPick: string[]): BuilderModel {
  let call = 0;
  return {
    object: async () => {
      call += 1;
      if (call === 1)
        return {
          name: 'pdf_qa',
          description: 'PDF Q&A.',
          systemPrompt: 'Answer about a PDF.',
          role: 'pdf',
          rationale: 'no pdf agent',
        } as never;
      return { servers: serverPick } as never;
    },
  };
}

async function deps(
  confirm: boolean,
  model: BuilderModel,
): Promise<BuilderDeps> {
  const dir = await mkdtemp(join(tmpdir(), 'ab-build-'));
  const agentsDir = join(dir, 'agents');
  await Bun.write(join(agentsDir, 'index.ts'), INDEX_SEED);
  return {
    model,
    existingNames: () => ['file_qa'],
    packNames: () => ['filesystem', 'fetch'],
    confirm: async () => confirm,
    paths: {
      agentsDir,
      indexPath: join(agentsDir, 'index.ts'),
      mcpConfigPath: join(dir, 'mcp.json'),
    },
  };
}

describe('buildAgent', () => {
  it('writes the agent on consent', async () => {
    const d = await deps(true, twoStepModel(['filesystem']));
    const r = await buildAgent('read pdfs', d);
    expect(r.kind).toBe('written');
    if (r.kind === 'written') {
      expect(r.proposal.name).toBe('pdf_qa');
      const idx = await readFile(d.paths.indexPath, 'utf8');
      expect(idx).toContain('pdf_qa: createPdfQaAgent,');
    }
  });
  it('writes nothing when consent is declined', async () => {
    const d = await deps(false, twoStepModel(['filesystem']));
    const r = await buildAgent('read pdfs', d);
    expect(r.kind).toBe('declined');
    const idx = await readFile(d.paths.indexPath, 'utf8');
    expect(idx).not.toContain('pdf_qa');
  });
  it('returns invalid (no consent asked) when the draft fails validation', async () => {
    let asked = false;
    const model = twoStepModel(['filesystem']);
    const d = await deps(true, model);
    d.existingNames = () => ['file_qa', 'pdf_qa']; // force duplicate-name rejection
    d.confirm = async () => {
      asked = true;
      return true;
    };
    const r = await buildAgent('read pdfs', d);
    expect(r.kind).toBe('invalid');
    expect(asked).toBe(false);
  });
});
