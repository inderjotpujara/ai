## Task 5: `write.ts` — render agent file, register, scope mcp.json

**Files:**
- Create: `src/agent-builder/write.ts`
- Test: `tests/agent-builder/write.test.ts`

**Interfaces:**
- Consumes: `AgentProposal` (Task 2); `getPackEntry` (`src/mcp/pack.ts`); the `AGENT-BUILDER:IMPORTS`/`AGENT-BUILDER:ENTRIES` markers in `agents/index.ts` (Task 1).
- Produces:
  ```ts
  export type WritePaths = { agentsDir: string; indexPath: string; mcpConfigPath: string };
  export function writeAgent(p: AgentProposal, paths: WritePaths): string[]; // returns written file paths
  export function pascalCase(snake: string): string; // 'pdf_qa' -> 'PdfQa'
  ```
  Synchronous (`node:fs`), atomic per file (temp + `renameSync`).

- [ ] **Step 1: Write the failing test**

Create `tests/agent-builder/write.test.ts`:

```typescript
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'bun:test';
import { Capability, PreferPolicy } from '../../src/core/types.ts';
import type { AgentProposal } from '../../src/agent-builder/types.ts';
import { pascalCase, writeAgent } from '../../src/agent-builder/write.ts';

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
  modelReq: { role: 'pdf reasoning', requires: [Capability.Tools], prefer: PreferPolicy.LargestThatFits },
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
    const agentFile = await readFile(join(paths.agentsDir, 'pdf_qa.ts'), 'utf8');
    expect(agentFile).toContain('export function createPdfQaAgent(tools: ToolSet): Agent');
    expect(agentFile).toContain("name: 'pdf_qa'");
    expect(agentFile).toContain('requires: [Capability.Tools]');
    expect(files).toContain(join(paths.agentsDir, 'pdf_qa.ts'));
  });
  it('inserts import + entry into index.ts at the markers', async () => {
    const paths = await setup();
    writeAgent(proposal, paths);
    const idx = await readFile(paths.indexPath, 'utf8');
    expect(idx).toContain("import { createPdfQaAgent } from './pdf_qa.ts';");
    expect(idx).toContain('pdf_qa: createPdfQaAgent,');
    expect(idx.indexOf('createPdfQaAgent')).toBeLessThan(idx.indexOf('AGENT-BUILDER:IMPORTS'));
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
    await Bun.write(paths.mcpConfigPath, JSON.stringify({ mcpServers: { filesystem: { command: 'x', agents: ['other'] } } }));
    writeAgent(proposal, paths);
    const cfg = JSON.parse(await readFile(paths.mcpConfigPath, 'utf8'));
    expect(cfg.mcpServers.filesystem.command).toBe('x'); // preserved
    expect(cfg.mcpServers.filesystem.agents).toEqual(['other', 'pdf_qa']); // appended
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/agent-builder/write.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/agent-builder/write.ts`**

```typescript
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getPackEntry } from '../mcp/pack.ts';
import type { AgentProposal } from './types.ts';

export type WritePaths = { agentsDir: string; indexPath: string; mcpConfigPath: string };

export function pascalCase(snake: string): string {
  return snake.split('_').filter(Boolean).map((s) => s[0].toUpperCase() + s.slice(1)).join('');
}

function atomicWrite(path: string, content: string): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, content);
  renameSync(tmp, path);
}

function renderAgentFile(p: AgentProposal): string {
  const Factory = `create${pascalCase(p.name)}Agent`;
  // JSON.stringify safely escapes the generated strings into TS string literals.
  return `import type { ToolSet } from 'ai';
import qwenFast from '../models/qwen-fast.ts';
import type { Agent } from '../src/core/agent-def.ts';
import { Capability, PreferPolicy } from '../src/core/types.ts';
import { createOllamaModel } from '../src/providers/ollama.ts';

// Generated by the agent-builder (Slice 17). Safe to edit by hand.
const SYSTEM_PROMPT = ${JSON.stringify(p.systemPrompt)};

export function ${Factory}(tools: ToolSet): Agent {
  return {
    name: ${JSON.stringify(p.name)},
    description: ${JSON.stringify(p.description)},
    model: createOllamaModel(qwenFast),
    systemPrompt: SYSTEM_PROMPT,
    tools,
    modelDecl: qwenFast,
    modelReq: {
      role: ${JSON.stringify(p.modelReq.role)},
      requires: [Capability.Tools],
      prefer: PreferPolicy.LargestThatFits,
    },
  };
}
`;
}

function registerInIndex(indexPath: string, p: AgentProposal): void {
  const Factory = `create${pascalCase(p.name)}Agent`;
  let idx = readFileSync(indexPath, 'utf8');
  const importLine = `import { ${Factory} } from './${p.name}.ts';\n`;
  const entryLine = `  ${p.name}: ${Factory},\n`;
  const IMPORTS = '// AGENT-BUILDER:IMPORTS';
  const ENTRIES = '// AGENT-BUILDER:ENTRIES';
  if (!idx.includes(IMPORTS) || !idx.includes(ENTRIES)) {
    throw new Error(`agents/index.ts is missing the AGENT-BUILDER markers`);
  }
  if (!idx.includes(importLine)) idx = idx.replace(IMPORTS, importLine + IMPORTS);
  if (!idx.includes(entryLine)) idx = idx.replace(ENTRIES, entryLine + ENTRIES);
  atomicWrite(indexPath, idx);
}

function scopeMcp(mcpConfigPath: string, p: AgentProposal): void {
  let cfg: { mcpServers?: Record<string, Record<string, unknown>> } = {};
  try {
    cfg = JSON.parse(readFileSync(mcpConfigPath, 'utf8'));
  } catch {
    cfg = {};
  }
  const servers = (cfg.mcpServers ??= {});
  for (const s of p.suggestedServers) {
    const entry = getPackEntry(s.packName);
    if (!entry) continue; // validate.ts already guarantees palette membership
    const current = (servers[s.packName] ??= { ...entry.server }) as Record<string, unknown>;
    const agents = Array.isArray(current.agents) ? (current.agents as string[]) : [];
    if (!agents.includes(p.name)) agents.push(p.name);
    current.agents = agents;
  }
  atomicWrite(mcpConfigPath, `${JSON.stringify(cfg, null, 2)}\n`);
}

/** Write the generated agent file, register it in agents/index.ts, and add/scope
 *  its suggested pack servers in mcp.json. Atomic per file. Returns files written. */
export function writeAgent(p: AgentProposal, paths: WritePaths): string[] {
  const written: string[] = [];
  const agentPath = join(paths.agentsDir, `${p.name}.ts`);
  atomicWrite(agentPath, renderAgentFile(p));
  written.push(agentPath);
  registerInIndex(paths.indexPath, p);
  written.push(paths.indexPath);
  if (p.suggestedServers.length > 0) {
    scopeMcp(paths.mcpConfigPath, p);
    written.push(paths.mcpConfigPath);
  }
  return written;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/agent-builder/write.test.ts`
Expected: PASS (all). If the generated agent file's format trips lint later, that's handled at Task 7 (the builder runs on real output); the test asserts content, not formatting.

- [ ] **Step 5: Typecheck, lint, commit**

Run: `bun run typecheck`; `bun run lint:file -- "src/agent-builder/write.ts" "tests/agent-builder/write.test.ts"`.

```bash
git add src/agent-builder/write.ts tests/agent-builder/write.test.ts
git commit -m "feat(agent-builder): writeAgent — render file + register in index + scope mcp.json, atomic (Slice 17 Task 5)"
```

---

