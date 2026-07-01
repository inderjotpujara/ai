## Task 2: `buildCrewAgent` (role/goal/backstory → Agent)

**Files:**
- Create: `src/crew/member-agent.ts`
- Test: `tests/crew/member-agent.test.ts`

**Interfaces:**
- Consumes: `CrewMember` (Task 1); `Agent` from `src/core/agent-def.ts` (`{ name; description; model; systemPrompt; tools; modelDecl?; modelReq? }`); `createOllamaModel` from `src/providers/ollama.ts`; `qwenFast` default export from `models/qwen-fast.ts`; `Capability`/`PreferPolicy`/`ModelRequirement` from `src/core/types.ts`.
- Produces: `function buildCrewAgent(member: CrewMember, tools?: ToolSet): Agent`.

- [ ] **Step 1: Write the failing test `tests/crew/member-agent.test.ts`**

```typescript
import { describe, expect, it } from 'bun:test';
import { Capability, PreferPolicy } from '../../src/core/types.ts';
import { buildCrewAgent } from '../../src/crew/member-agent.ts';
import type { CrewMember } from '../../src/crew/types.ts';

const member: CrewMember = {
  name: 'researcher',
  role: 'Senior Research Analyst',
  goal: 'Find accurate, current facts on the topic',
  backstory: 'You have 10 years scouring primary sources.',
  requires: [Capability.Tools],
  prefer: PreferPolicy.LargestThatFits,
};

describe('buildCrewAgent', () => {
  it('composes role/goal/backstory into the system prompt', () => {
    const agent = buildCrewAgent(member, {});
    expect(agent.name).toBe('researcher');
    expect(agent.systemPrompt).toContain('Senior Research Analyst');
    expect(agent.systemPrompt).toContain('Find accurate, current facts');
    expect(agent.systemPrompt).toContain('10 years scouring');
    // description drives hierarchical routing → carries role + goal
    expect(agent.description).toContain('Senior Research Analyst');
  });

  it('sets modelReq for live selection, not a hardcoded model choice', () => {
    const agent = buildCrewAgent(member, {});
    expect(agent.modelReq).toEqual({
      role: 'Senior Research Analyst',
      requires: [Capability.Tools],
      prefer: PreferPolicy.LargestThatFits,
    });
    // a default model is present (overridden live by the selector at delegation)
    expect(agent.model).toBeDefined();
  });

  it('uses the member tools when provided', () => {
    const tools = { probe: { description: 'x', inputSchema: undefined, execute: async () => ({}) } };
    const agent = buildCrewAgent({ ...member, tools } as CrewMember);
    expect(agent.tools).toBe(tools);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/crew/member-agent.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/crew/member-agent.ts`**

```typescript
import type { ToolSet } from 'ai';
import qwenFast from '../../models/qwen-fast.ts';
import type { Agent } from '../core/agent-def.ts';
import { createOllamaModel } from '../providers/ollama.ts';
import type { CrewMember } from './types.ts';

/** Compose a crew member's role/goal/backstory into an Agent. The model is a
 *  default placeholder; the real model is chosen LIVE by the selector at
 *  delegation (via modelReq + onBeforeDelegate), exactly like the preset agents. */
export function buildCrewAgent(member: CrewMember, tools?: ToolSet): Agent {
  const systemPrompt = [
    `You are ${member.role}.`,
    `Your goal: ${member.goal}`,
    `Background: ${member.backstory}`,
    'Do the task you are given. Use your tools when they help. Return only the result the task asks for — no preamble.',
  ].join('\n');

  return {
    name: member.name,
    description: `${member.role} — ${member.goal}`,
    model: createOllamaModel(qwenFast),
    systemPrompt,
    tools: member.tools ?? tools ?? {},
    modelDecl: qwenFast,
    modelReq: {
      role: member.role,
      requires: member.requires,
      prefer: member.prefer,
    },
  };
}
```

- [ ] **Step 4: Run tests + typecheck + lint**

Run: `bun test tests/crew/member-agent.test.ts && bun run typecheck && bun run lint:file -- "src/crew/member-agent.ts"`
Expected: PASS; clean.

- [ ] **Step 5: Commit**

```bash
git add src/crew/member-agent.ts tests/crew/member-agent.test.ts
git commit -m "feat(crew): buildCrewAgent composes role/goal/backstory"
```

---

