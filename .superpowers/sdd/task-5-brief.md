### Task 5: Build the Agent Card

**Files:**
- Create: `src/a2a/card.ts`
- Test: `tests/a2a/card.test.ts`

**Interfaces:**
- Consumes: `A2aAllowlist`, `SkillEntry` (Task 4); `AgentCardSchema`, `AgentSkillSchema`, `A2aAgentCard` from `../contracts/index.ts`; `loadConfig` (for `AGENT_A2A_CARD_TTL` + the Slice-24 bind/tunnel-origin — the advertised `url`).
- Produces:
  - `buildAgentCard(deps: { allowlist: A2aAllowlist; publicBaseUrl: string; name?: string; version?: string }): A2aAgentCard` — maps each `SkillEntry` → `AgentSkill`; `capabilities: { streaming: true, pushNotifications: false }`; `protocolVersion: '1.0'`; `url = \`${publicBaseUrl}/api/a2a\``; one HTTP Bearer scheme in `securitySchemes` (`{ a2aBearer: { type: 'http', scheme: 'bearer' } }`) + `security: [{ a2aBearer: [] }]`; `defaultInputModes/OutputModes: ['text/plain','application/json']`. An empty allowlist ⇒ `skills: []`. Returns the `AgentCardSchema.parse`d object (self-validating).
  - `cardEtag(card: A2aAgentCard): string` — `sha256(canonical JSON)` (reuse Task 20's `canonicalizeCard` once it lands; for now a stable `JSON.stringify` of sorted keys — extract the shared canonicalizer in Task 20 and re-point).

- [ ] **Step 1: Write the failing tests** — a card with skills; an empty allowlist ⇒ `skills:[]`; url points at `/api/a2a`:

```ts
import { expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JobKind } from '../../src/queue/types.ts';
import { createA2aAllowlist } from '../../src/a2a/allowlist.ts';
import { buildAgentCard } from '../../src/a2a/card.ts';

test('empty allowlist yields a valid card with skills:[]', () => {
  const al = createA2aAllowlist({ path: join(mkdtempSync(join(tmpdir(), 'a2a-')), 's.json') });
  const card = buildAgentCard({ allowlist: al, publicBaseUrl: 'https://box.ts.net' });
  expect(card.skills).toEqual([]);
  expect(card.protocolVersion).toBe('1.0');
  expect(card.url).toBe('https://box.ts.net/api/a2a');
  expect(card.capabilities.pushNotifications).toBe(false);
});
test('a listed skill surfaces on the card', () => {
  const al = createA2aAllowlist({ path: join(mkdtempSync(join(tmpdir(), 'a2a-')), 's.json') });
  al.put({ skillId: 'ask', name: 'Ask', description: 'qa', kind: JobKind.Chat, ref: 'file_qa' });
  const card = buildAgentCard({ allowlist: al, publicBaseUrl: 'https://box.ts.net' });
  expect(card.skills.map((s) => s.id)).toEqual(['ask']);
});
```

- [ ] **Step 2: Run tests to verify they fail** → FAIL.
- [ ] **Step 3: Write minimal implementation** per the Produces block.
- [ ] **Step 4: Run tests to verify they pass** → PASS.
- [ ] **Step 5: Gate + commit** — `bun run typecheck && bun run lint:file -- src/a2a/card.ts tests/a2a/card.test.ts`.

```bash
git add src/a2a/card.ts tests/a2a/card.test.ts
git commit -m "feat(a2a): build v1.0 Agent Card from the skill allowlist (skills:[] when empty)"
```

*Model: Sonnet.*

