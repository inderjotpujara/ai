## Task 2: agent-builder types + structural validation

**Files:**
- Create: `src/agent-builder/types.ts`, `src/agent-builder/validate.ts`
- Test: `tests/agent-builder/validate.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // types.ts
  export type SuggestedServer = { packName: string; scopeToAgent: string };
  export type AgentProposal = {
    name: string; description: string; systemPrompt: string;
    modelReq: ModelRequirement; suggestedServers: SuggestedServer[]; rationale: string;
  };
  export type ValidationIssue = { field: string; problem: string };
  export type BuildResult =
    | { kind: 'written'; proposal: AgentProposal; files: string[] }
    | { kind: 'declined' }
    | { kind: 'invalid'; issues: ValidationIssue[] }
    | { kind: 'abandoned'; reason: string };
  // validate.ts
  export function validateProposal(
    p: AgentProposal, existingNames: string[], packNames: string[],
  ): ValidationIssue[];
  ```

- [ ] **Step 1: Write the failing test**

Create `tests/agent-builder/validate.test.ts`:

```typescript
import { describe, expect, it } from 'bun:test';
import { Capability, PreferPolicy } from '../../src/core/types.ts';
import type { AgentProposal } from '../../src/agent-builder/types.ts';
import { validateProposal } from '../../src/agent-builder/validate.ts';

const base: AgentProposal = {
  name: 'pdf_qa',
  description: 'Answers questions about PDF files.',
  systemPrompt: 'You answer questions about a PDF.',
  modelReq: { role: 'pdf reasoning', requires: [Capability.Tools], prefer: PreferPolicy.LargestThatFits },
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
    const issues = validateProposal({ ...base, name: 'file_qa' }, existing, pack);
    expect(issues.some((i) => i.field === 'name')).toBe(true);
  });
  it('rejects reserved names', () => {
    expect(validateProposal({ ...base, name: 'super' }, existing, pack).some((i) => i.field === 'name')).toBe(true);
  });
  it('rejects non-snake_case names', () => {
    expect(validateProposal({ ...base, name: 'PdfQA' }, existing, pack).some((i) => i.field === 'name')).toBe(true);
  });
  it('rejects empty description and systemPrompt', () => {
    expect(validateProposal({ ...base, description: '  ' }, existing, pack).some((i) => i.field === 'description')).toBe(true);
    expect(validateProposal({ ...base, systemPrompt: '' }, existing, pack).some((i) => i.field === 'systemPrompt')).toBe(true);
  });
  it('rejects an off-palette server (least-privilege)', () => {
    const issues = validateProposal({ ...base, suggestedServers: [{ packName: 'evil-server', scopeToAgent: 'pdf_qa' }] }, existing, pack);
    expect(issues.some((i) => i.field === 'suggestedServers')).toBe(true);
  });
  it('rejects a mis-scoped server', () => {
    const issues = validateProposal({ ...base, suggestedServers: [{ packName: 'filesystem', scopeToAgent: 'other' }] }, existing, pack);
    expect(issues.some((i) => i.field === 'suggestedServers')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/agent-builder/validate.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Create `src/agent-builder/types.ts`**

```typescript
import type { ModelRequirement } from '../core/types.ts';

/** A curated-pack MCP server the generated agent needs, scoped to that agent. */
export type SuggestedServer = { packName: string; scopeToAgent: string };

/** A drafted specialist agent: definition + the minimal scoped tools it needs. */
export type AgentProposal = {
  name: string; // snake_case, unique vs the registry
  description: string; // the orchestrator routes on this
  systemPrompt: string;
  modelReq: ModelRequirement;
  suggestedServers: SuggestedServer[]; // pack-only, each scoped to `name`
  rationale: string; // why this agent + these tools (shown to the user)
};

export type ValidationIssue = { field: string; problem: string };

export type BuildResult =
  | { kind: 'written'; proposal: AgentProposal; files: string[] }
  | { kind: 'declined' }
  | { kind: 'invalid'; issues: ValidationIssue[] }
  | { kind: 'abandoned'; reason: string };
```

- [ ] **Step 4: Create `src/agent-builder/validate.ts`**

```typescript
import type { AgentProposal, ValidationIssue } from './types.ts';

const SNAKE = /^[a-z][a-z0-9_]*$/;
const RESERVED = new Set(['super', 'orchestrator']);

/** Structural gate. Palette-only tools + unique snake_case name + non-empty
 *  fields + each server scoped to this agent. No LLM, no I/O. */
export function validateProposal(
  p: AgentProposal,
  existingNames: string[],
  packNames: string[],
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!SNAKE.test(p.name)) {
    issues.push({ field: 'name', problem: `"${p.name}" is not snake_case ([a-z][a-z0-9_]*)` });
  } else if (RESERVED.has(p.name) || existingNames.includes(p.name)) {
    issues.push({ field: 'name', problem: `"${p.name}" is reserved or already exists` });
  }
  if (p.description.trim().length === 0) {
    issues.push({ field: 'description', problem: 'description is empty' });
  }
  if (p.systemPrompt.trim().length === 0) {
    issues.push({ field: 'systemPrompt', problem: 'systemPrompt is empty' });
  }
  for (const s of p.suggestedServers) {
    if (!packNames.includes(s.packName)) {
      issues.push({ field: 'suggestedServers', problem: `"${s.packName}" is not in the curated pack (palette-only)` });
    }
    if (s.scopeToAgent !== p.name) {
      issues.push({ field: 'suggestedServers', problem: `"${s.packName}" must be scoped to "${p.name}", not "${s.scopeToAgent}"` });
    }
  }
  return issues;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test tests/agent-builder/validate.test.ts`
Expected: PASS (all 7).

- [ ] **Step 6: Typecheck, lint, commit**

Run: `bun run typecheck`; `bun run lint:file -- "src/agent-builder/types.ts" "src/agent-builder/validate.ts" "tests/agent-builder/validate.test.ts"`.

```bash
git add src/agent-builder/types.ts src/agent-builder/validate.ts tests/agent-builder/validate.test.ts
git commit -m "feat(agent-builder): AgentProposal types + structural validateProposal (Slice 17 Task 2)"
```

---

