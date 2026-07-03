## Task 1: `agents/index.ts` registry + behavior-preserving rewiring

**Files:**
- Create: `agents/index.ts`
- Modify: `agents/super.ts`, `src/cli/chat.ts` (~110-114), `src/cli/flow.ts` (~130-136)
- Test: `tests/agents/registry.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // agents/index.ts
  export type AgentFactory = (tools: ToolSet) => Agent;
  export const AGENTS: Record<string, AgentFactory>;   // insertion order: file_qa, web_fetch
  export function agentNames(): string[];
  ```
  `createSuperAgent(toolsFor: (name: string) => ToolSet, onBeforeDelegate?: BeforeDelegate): Agent` (signature CHANGED from two positional ToolSets).

- [ ] **Step 1: Write the failing test**

Create `tests/agents/registry.test.ts`:

```typescript
import { describe, expect, it } from 'bun:test';
import type { ToolSet } from 'ai';
import { AGENTS, agentNames } from '../../agents/index.ts';
import { createSuperAgent } from '../../agents/super.ts';

describe('agents registry', () => {
  it('registers file_qa and web_fetch in order', () => {
    expect(agentNames()).toEqual(['file_qa', 'web_fetch']);
    expect(typeof AGENTS.file_qa).toBe('function');
    expect(typeof AGENTS.web_fetch).toBe('function');
  });
  it('each factory builds an Agent with the expected name', () => {
    const empty: ToolSet = {};
    expect(AGENTS.file_qa(empty).name).toBe('file_qa');
    expect(AGENTS.web_fetch(empty).name).toBe('web_fetch');
  });
  it('createSuperAgent builds delegate tools for every registered agent', () => {
    const orch = createSuperAgent(() => ({}), undefined);
    expect(Object.keys(orch.tools)).toContain('delegate_to_file_qa');
    expect(Object.keys(orch.tools)).toContain('delegate_to_web_fetch');
    expect(Object.keys(orch.tools)).toContain('report_capability_gap');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/agents/registry.test.ts`
Expected: FAIL — `Cannot find module '../../agents/index.ts'`.

- [ ] **Step 3: Create `agents/index.ts`**

```typescript
import type { ToolSet } from 'ai';
import type { Agent } from '../src/core/agent-def.ts';
import { createFileQaAgent } from './file-qa.ts';
import { createWebFetchAgent } from './web-fetch.ts';
// AGENT-BUILDER:IMPORTS (generated agent imports are inserted above this line — do not remove)

/** A specialist is a factory taking its (MCP-scoped) tool set and returning an Agent. */
export type AgentFactory = (tools: ToolSet) => Agent;

/** The registry of available specialists, keyed by Agent.name (snake_case).
 *  Insertion order is the orchestrator's routing-catalog order. */
export const AGENTS: Record<string, AgentFactory> = {
  file_qa: createFileQaAgent,
  web_fetch: createWebFetchAgent,
  // AGENT-BUILDER:ENTRIES (generated agent entries are inserted above this line — do not remove)
};

export function agentNames(): string[] {
  return Object.keys(AGENTS);
}
```

- [ ] **Step 4: Refactor `agents/super.ts` to build from the registry**

Replace the whole file with:

```typescript
import type { ToolSet } from 'ai';
import qwenRouter from '../models/qwen-router.ts';
import type { Agent } from '../src/core/agent-def.ts';
import type { BeforeDelegate } from '../src/core/delegate.ts';
import { createOrchestrator } from '../src/core/orchestrator.ts';
import { createOllamaModel } from '../src/providers/ollama.ts';
import { AGENTS, agentNames } from './index.ts';

const BASE_PROMPT =
  'You are an orchestrator. You do not perform tasks yourself; you route them to specialized agents.';

/** Build the super-agent (orchestrator) with every registered specialist.
 *  `toolsFor(name)` supplies each agent's MCP-scoped tool set (reg.forAgent). */
export function createSuperAgent(
  toolsFor: (name: string) => ToolSet,
  onBeforeDelegate?: BeforeDelegate,
): Agent {
  const agents: Agent[] = agentNames().map((name) => AGENTS[name](toolsFor(name)));
  return createOrchestrator({
    name: 'super',
    model: createOllamaModel(qwenRouter),
    systemPrompt: BASE_PROMPT,
    agents,
    onBeforeDelegate,
  });
}
```

- [ ] **Step 5: Update `src/cli/chat.ts` call site**

Find `createSuperAgent(reg.forAgent('file_qa'), reg.forAgent('web_fetch'), onBeforeDelegate)` (~line 110-114) and replace with:

```typescript
      const orchestrator = createSuperAgent(
        (name) => reg.forAgent(name),
        onBeforeDelegate,
      );
```

- [ ] **Step 6: Update `src/cli/flow.ts` agent-map construction**

Find the block (~130-136):

```typescript
        const agents: Record<string, Agent> = {};
        const fileQa = createFileQaAgent(reg.forAgent('file_qa'));
        const webFetch = createWebFetchAgent(reg.forAgent('web_fetch'));
        agents[fileQa.name] = fileQa;
        agents[webFetch.name] = webFetch;
        warnUnknownAgents(config, Object.keys(agents), (m) => console.error(m));
```

Replace with (build from the registry; drop the now-unused `createFileQaAgent`/`createWebFetchAgent` imports):

```typescript
        const agents: Record<string, Agent> = {};
        for (const name of agentNames()) {
          agents[name] = AGENTS[name](reg.forAgent(name));
        }
        warnUnknownAgents(config, Object.keys(agents), (m) => console.error(m));
```

Add the import `import { AGENTS, agentNames } from '../../agents/index.ts';` and remove the two now-unused `import { createFileQaAgent } ...` / `createWebFetchAgent` lines (let lint confirm). `crew.ts` uses `reg.merged` (not per-agent) and is unchanged.

- [ ] **Step 7: Run tests + typecheck**

Run: `bun test tests/agents/registry.test.ts tests/cli/flow.test.ts` (expect PASS), `bun run typecheck` (clean).

- [ ] **Step 8: Lint + commit**

Run: `bun run lint:file -- "agents/index.ts" "agents/super.ts" "src/cli/chat.ts" "src/cli/flow.ts" "tests/agents/registry.test.ts"`.

```bash
git add agents/index.ts agents/super.ts src/cli/chat.ts src/cli/flow.ts tests/agents/registry.test.ts
git commit -m "refactor(agents): agents/index.ts registry; super/chat/flow build agent set from it (Slice 17 Task 1)"
```

---

