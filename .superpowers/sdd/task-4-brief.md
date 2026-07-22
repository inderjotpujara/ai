### Task 4: A2A skill allowlist store + ref resolution (HARD §7.4)

**Files:**
- Create: `src/a2a/allowlist.ts`
- Test: `tests/a2a/allowlist.test.ts`

**Interfaces:**
- Consumes: `JobKind` from `../queue/types.ts`; `AGENTS` from `../../agents/index.ts`; `getCrew` from `../../crews/index.ts`; `getWorkflow` from `../../workflows/index.ts`; the `~/.agent`-style atomic-write idiom from `src/server/security/device-registry.ts`; `loadConfig` for `AGENT_A2A_SKILLS_PATH`.
- Produces:

```ts
export type SkillEntry = {
  skillId: string;
  name: string;
  description: string;
  kind: JobKind;        // Chat | Crew | Workflow — the enqueue target kind
  ref: string;          // registered agent name (AGENTS) | crew name | workflow name
};
export type ResolvedTarget = { kind: JobKind; ref: string };
export type A2aAllowlist = {
  list(): SkillEntry[];
  /** Author-time validation: the ref MUST resolve to a REGISTERED agent/crew/
   *  workflow for its kind, else throw AllowlistError. NEVER a "run anything"
   *  entry (§7.4). */
  put(entry: SkillEntry): void;
  remove(skillId: string): void;
  /** Invoke-time re-check: resolve a presented skillId to its target, or
   *  undefined if unlisted (server resolves-then-rejects — never a fall-through
   *  to a generic orchestrator run, §7.4). */
  resolve(skillId: string): ResolvedTarget | undefined;
};
export function createA2aAllowlist(config: { path?: string }): A2aAllowlist;
export function refExistsFor(kind: JobKind, ref: string): boolean; // AGENTS/getCrew/getWorkflow lookup
```

  File format: `{ skills: SkillEntry[] }` at `AGENT_A2A_SKILLS_PATH` (0700 dir / 0600 file, atomic temp+rename — byte-for-byte `device-registry.ts persist`). `put` validates `refExistsFor(entry.kind, entry.ref)` (Chat/Crew→`getCrew` or `AGENTS`, Workflow→`getWorkflow`) — throws `AllowlistError` on a non-existent ref, so an operator cannot expose a skill that maps to nothing. `resolve` re-reads and returns `{ kind, ref }` only for a listed `skillId`. Fail-closed on a corrupt (present-but-unparseable) file (throw, never `{ skills: [] }` — the `device-registry.ts load` precedent).

- [ ] **Step 1: Write the failing tests** — a valid put/resolve round-trip; an unknown ref rejects at author-time; an unlisted skillId resolves to `undefined`:

```ts
import { expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JobKind } from '../../src/queue/types.ts';
import { createA2aAllowlist } from '../../src/a2a/allowlist.ts';

const p = () => join(mkdtempSync(join(tmpdir(), 'a2a-')), 'a2a-skills.json');

test('put a valid agent-backed skill; resolve returns its target', () => {
  const al = createA2aAllowlist({ path: p() });
  al.put({ skillId: 'ask', name: 'Ask', description: 'qa',
    kind: JobKind.Chat, ref: 'file_qa' }); // file_qa is a registered agent
  expect(al.resolve('ask')).toEqual({ kind: JobKind.Chat, ref: 'file_qa' });
  expect(al.list().map((s) => s.skillId)).toEqual(['ask']);
});
test('put rejects a skill whose ref is not a registered agent/crew/workflow (§7.4)', () => {
  const al = createA2aAllowlist({ path: p() });
  expect(() => al.put({ skillId: 'x', name: 'X', description: '',
    kind: JobKind.Crew, ref: 'no_such_crew' })).toThrow();
});
test('resolve returns undefined for an unlisted skill (resolve-then-reject)', () => {
  const al = createA2aAllowlist({ path: p() });
  expect(al.resolve('ghost')).toBeUndefined();
});
```

- [ ] **Step 2: Run tests to verify they fail** → FAIL.
- [ ] **Step 3: Write minimal implementation** per the Produces block; copy the `device-registry.ts` load/persist/atomic-write structure (fail-closed load). `refExistsFor`: `kind===Workflow ? !!getWorkflow(ref) : kind===Crew ? !!getCrew(ref) : (!!AGENTS[ref] || !!getCrew(ref))` (Chat may target an agent or a crew, per the launch surface).
- [ ] **Step 4: Run tests to verify they pass** → PASS.
- [ ] **Step 5: Gate + commit** — `bun run typecheck && bun run lint:file -- src/a2a/allowlist.ts tests/a2a/allowlist.test.ts`.

```bash
git add src/a2a/allowlist.ts tests/a2a/allowlist.test.ts
git commit -m "feat(a2a): least-privilege skill allowlist store + author-time ref resolution"
```

*Model: **Opus implementer + ADVERSARIAL-VERIFY (§7.4 least-privilege).** Reviewer probes: is there ANY path to expose an unregistered ref or a free-form "run anything" skill? Does `resolve` genuinely return `undefined` (never a default target) for an unlisted id? Is the load fail-closed on a corrupt file?*

