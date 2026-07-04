### Task 11: CrewMember.agentRef + crew-engine resolution

**Files:**
- Modify: `src/crew/types.ts` (add `agentRef?` to `CrewMember`)
- Modify: `src/crew/engine.ts` (`crewAgentMap` uses `AGENTS[agentRef]` when present)
- Test: `tests/crew/agent-ref.test.ts`

**Interfaces:**
- Consumes: `AGENTS`, `AgentFactory` from `agents/index.ts`.
- Produces: crew members can reuse a registered specialist by `agentRef`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/crew/agent-ref.test.ts
import { expect, test } from 'bun:test';
import { crewAgentMap } from '../../src/crew/engine.ts';
import { CrewProcess, type CrewDef } from '../../src/crew/types.ts';

test('a member with agentRef resolves to the registered factory', () => {
  const crew: CrewDef = {
    id: 'c', process: CrewProcess.Sequential,
    members: [{ name: 'wf', agentRef: 'web_fetch', role: 'r', goal: 'g', backstory: 'b', requires: [], prefer: 'largest-that-fits' as never }],
    tasks: [{ id: 't', description: 'd', expectedOutput: 'o', member: 'wf' }],
  };
  const map = crewAgentMap(crew, {});
  expect(map.wf.name).toBe('web_fetch'); // came from the registered agent, not a fresh inline build
});
```

- [ ] **Step 2: Run — FAIL.**

- [ ] **Step 3: Implement** — add the optional field + resolution:

```ts
// src/crew/types.ts — add to CrewMember (additive):
  /** When set, reuse this registered AGENTS specialist instead of an inline build. */
  agentRef?: string;
```

```ts
// src/crew/engine.ts — in crewAgentMap, replace the buildCrewAgent line:
import { AGENTS } from '../../agents/index.ts';
// ...
  for (const member of crew.members) {
    const memberTools = { ...(member.tools ?? tools), ...recallTools };
    const factory = member.agentRef ? AGENTS[member.agentRef] : undefined;
    map[member.name] = factory ? factory(memberTools) : buildCrewAgent(member, memberTools);
  }
```

> NOTE for implementer: confirm `src/crew/engine.ts` doesn't already import from `agents/index.ts` (avoid a cycle — `agents/*.ts` import from `src/`, not vice-versa; `engine.ts` importing the registry is fine as it's a leaf consumer). Run the full crew test suite after: `bun test tests/crew/`.

- [ ] **Step 4: Run — PASS** (`bun test tests/crew/ && bun run typecheck`).

- [ ] **Step 5: Commit**

```bash
git add src/crew/types.ts src/crew/engine.ts tests/crew/agent-ref.test.ts
git commit -m "feat(crew): CrewMember.agentRef reuses a registered specialist"
```

---

