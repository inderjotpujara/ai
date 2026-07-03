## Task 6: `builder.ts` orchestration + `agent.build` telemetry

**Files:**
- Create: `src/agent-builder/builder.ts`
- Modify: `src/telemetry/spans.ts` (add `ATTR` keys + `withAgentBuildSpan`)
- Test: `tests/agent-builder/builder.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 2-5.
- Produces:
  ```ts
  // types.ts (add BuilderDeps)
  export type BuilderDeps = {
    model: BuilderModel;
    existingNames: () => string[];
    packNames: () => string[];
    confirm: (proposalText: string) => Promise<boolean>;
    paths: WritePaths;               // from write.ts
    log?: (m: string) => void;
  };
  // builder.ts
  export function renderProposal(p: AgentProposal): string;   // human-readable consent text
  export function buildAgent(need: string, deps: BuilderDeps): Promise<BuildResult>;
  ```

- [ ] **Step 1: Write the failing test**

Create `tests/agent-builder/builder.test.ts`:

```typescript
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'bun:test';
import type { BuilderDeps, BuilderModel } from '../../src/agent-builder/types.ts';
import { buildAgent } from '../../src/agent-builder/builder.ts';

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
      if (call === 1) return { name: 'pdf_qa', description: 'PDF Q&A.', systemPrompt: 'Answer about a PDF.', role: 'pdf', rationale: 'no pdf agent' } as never;
      return { servers: serverPick } as never;
    },
  };
}

async function deps(confirm: boolean, model: BuilderModel): Promise<BuilderDeps> {
  const dir = await mkdtemp(join(tmpdir(), 'ab-build-'));
  const agentsDir = join(dir, 'agents');
  await Bun.write(join(agentsDir, 'index.ts'), INDEX_SEED);
  return {
    model,
    existingNames: () => ['file_qa'],
    packNames: () => ['filesystem', 'fetch'],
    confirm: async () => confirm,
    paths: { agentsDir, indexPath: join(agentsDir, 'index.ts'), mcpConfigPath: join(dir, 'mcp.json') },
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
    d.confirm = async () => { asked = true; return true; };
    const r = await buildAgent('read pdfs', d);
    expect(r.kind).toBe('invalid');
    expect(asked).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/agent-builder/builder.test.ts`
Expected: FAIL — `builder.ts` / `BuilderDeps` not found.

- [ ] **Step 3: Add `ATTR` keys + `withAgentBuildSpan` to `src/telemetry/spans.ts`**

In the `ATTR` object (after the `agent.gap.*`/existing keys), add:

```typescript
  BUILD_NEED: 'agent.build.need',
  BUILD_AGENT: 'agent.build.agent_name',
  BUILD_OUTCOME: 'agent.build.outcome',
  BUILD_SERVERS: 'agent.build.server_count',
```

Add the span helper near the other `with*Span` helpers:

```typescript
/** Root span for one agent-builder run (Slice 17). The body records stage
 *  events (generated / validated / suggested / consent / written) and sets
 *  the outcome + counts at the end via the returned recorder. */
export function withAgentBuildSpan<T>(
  need: string,
  fn: (rec: {
    event: (name: string, attrs?: Record<string, string | number | boolean>) => void;
    outcome: (kind: string, agentName?: string, serverCount?: number) => void;
  }) => Promise<T>,
): Promise<T> {
  return inSpan('agent.build', async (span) => {
    span.setAttribute(ATTR.BUILD_NEED, need);
    return fn({
      event: (name, attrs) => span.addEvent(name, attrs),
      outcome: (kind, agentName, serverCount) => {
        span.setAttribute(ATTR.BUILD_OUTCOME, kind);
        if (agentName) span.setAttribute(ATTR.BUILD_AGENT, agentName);
        if (serverCount !== undefined) span.setAttribute(ATTR.BUILD_SERVERS, serverCount);
      },
    });
  });
}
```

(`inSpan` and `ATTR` already exist in this file; match the existing style.)

- [ ] **Step 4: Add `BuilderDeps` to `src/agent-builder/types.ts` and create `builder.ts`**

Append to `types.ts`:

```typescript
import type { WritePaths } from './write.ts';

export type BuilderDeps = {
  model: BuilderModel;
  existingNames: () => string[];
  packNames: () => string[];
  confirm: (proposalText: string) => Promise<boolean>;
  paths: WritePaths;
  log?: (m: string) => void;
};
```

Create `src/agent-builder/builder.ts`:

```typescript
import { withAgentBuildSpan } from '../telemetry/spans.ts';
import { generateProposal } from './generate.ts';
import { suggestServers } from './suggest-tools.ts';
import type { AgentProposal, BuildResult, BuilderDeps } from './types.ts';
import { validateProposal } from './validate.ts';
import { writeAgent } from './write.ts';

/** Human-readable consent card for a proposal. */
export function renderProposal(p: AgentProposal): string {
  const servers = p.suggestedServers.length
    ? p.suggestedServers.map((s) => `  • ${s.packName} (scoped to ${s.scopeToAgent})`).join('\n')
    : '  • (none)';
  return [
    `Proposed agent: ${p.name}`,
    `  ${p.description}`,
    `Why: ${p.rationale}`,
    `Tools (MCP servers to mount):`,
    servers,
    `Files that will be written: agents/${p.name}.ts, agents/index.ts` +
      (p.suggestedServers.length ? `, mcp.json` : ''),
  ].join('\n');
}

/** generate → suggest → validate → consent → write. Consent is mandatory; on
 *  decline or invalid, nothing is written. */
export function buildAgent(need: string, deps: BuilderDeps): Promise<BuildResult> {
  return withAgentBuildSpan(need, async (rec) => {
    const draft = await generateProposal(need, deps.model);
    rec.event('generated', { name: draft.name });
    const proposal: AgentProposal = {
      ...draft,
      suggestedServers: await suggestServers(need, draft, deps.model),
    };
    rec.event('suggested', { count: proposal.suggestedServers.length });

    const issues = validateProposal(proposal, deps.existingNames(), deps.packNames());
    rec.event('validated', { ok: issues.length === 0, issues: issues.length });
    if (issues.length > 0) {
      rec.outcome('invalid');
      return { kind: 'invalid', issues };
    }

    const granted = await deps.confirm(renderProposal(proposal));
    rec.event('consent', { granted });
    if (!granted) {
      rec.outcome('declined', proposal.name);
      return { kind: 'declined' };
    }

    const files = writeAgent(proposal, deps.paths);
    rec.event('written', { files: files.length });
    rec.outcome('written', proposal.name, proposal.suggestedServers.length);
    deps.log?.(`Created agent "${proposal.name}" (${files.length} file(s)). It is live on the next run.`);
    return { kind: 'written', proposal, files };
  });
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test tests/agent-builder/builder.test.ts`
Expected: PASS (all 3 — written / declined / invalid-without-consent).

- [ ] **Step 6: Typecheck, lint, commit**

Run: `bun run typecheck`; `bun run lint:file -- "src/telemetry/spans.ts" "src/agent-builder/types.ts" "src/agent-builder/builder.ts" "tests/agent-builder/builder.test.ts"`.

```bash
git add src/telemetry/spans.ts src/agent-builder/types.ts src/agent-builder/builder.ts tests/agent-builder/builder.test.ts
git commit -m "feat(agent-builder): buildAgent orchestration (generate→suggest→validate→consent→write) + agent.build span (Slice 17 Task 6)"
```

---

