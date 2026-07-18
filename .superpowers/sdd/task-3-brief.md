## Task 3: Config — `AGENT_SESSIONS_PATH`

**Files:**
- Modify: `src/config/schema.ts` (append one `CONFIG_SPEC` entry, in a new "Session persistence" group right after the existing "Memory / RAG" group)
- Modify: `tests/config/schema.test.ts` (append one assertion)

**Interfaces:**
- Consumes: nothing new (mirrors the existing `AGENT_MEMORY_PATH` entry shape, `src/config/schema.ts:127-132`).
- Produces: a new `CONFIG_SPEC` entry `{ env: 'AGENT_SESSIONS_PATH', kind: 'string', def: 'sessions', doc: '...' }`, picked up automatically by `loadConfig()`'s existing generic loop (no new code path).

- [ ] **Step 1: Write the failing test**

Append to `tests/config/schema.test.ts` (full new file content):
```typescript
import { expect, test } from 'bun:test';
import { CONFIG_SPEC, loadConfig } from '../../src/config/schema.ts';

test('every entry has a doc string and a default', () => {
  for (const e of CONFIG_SPEC) {
    expect(e.doc.length).toBeGreaterThan(0);
    expect(e.def).toBeDefined();
  }
});
test('loadConfig applies defaults and records source', () => {
  const { values, sources } = loadConfig({});
  expect(values.AGENT_MAX_DELEGATION_DEPTH).toBe(5);
  expect(sources.AGENT_MAX_DELEGATION_DEPTH).toBe('default');
});
test('a valid env override wins and is marked env', () => {
  const { values, sources } = loadConfig({ AGENT_MAX_DELEGATION_DEPTH: '8' });
  expect(values.AGENT_MAX_DELEGATION_DEPTH).toBe(8);
  expect(sources.AGENT_MAX_DELEGATION_DEPTH).toBe('env');
});
test('an invalid number falls back to the default (env-fallback-only rule)', () => {
  const { values, sources } = loadConfig({
    AGENT_MAX_DELEGATION_DEPTH: 'notanumber',
  });
  expect(values.AGENT_MAX_DELEGATION_DEPTH).toBe(5);
  expect(sources.AGENT_MAX_DELEGATION_DEPTH).toBe('default');
});

test('AGENT_SESSIONS_PATH defaults to "sessions" (Slice 30b Phase 6)', () => {
  const { values, sources } = loadConfig({});
  expect(values.AGENT_SESSIONS_PATH).toBe('sessions');
  expect(sources.AGENT_SESSIONS_PATH).toBe('default');
});
test('AGENT_SESSIONS_PATH honors an env override (Slice 30b Phase 6)', () => {
  const { values, sources } = loadConfig({ AGENT_SESSIONS_PATH: '/tmp/custom-sessions' });
  expect(values.AGENT_SESSIONS_PATH).toBe('/tmp/custom-sessions');
  expect(sources.AGENT_SESSIONS_PATH).toBe('env');
});
```

- [ ] **Step 2: Run the test to verify the new cases fail**

Run: `bun test tests/config/schema.test.ts`
Expected: FAIL on the two new `AGENT_SESSIONS_PATH` tests — `values.AGENT_SESSIONS_PATH` is `undefined` (no such `CONFIG_SPEC` entry yet); the four pre-existing tests still PASS.

- [ ] **Step 3: Append the `CONFIG_SPEC` entry to `src/config/schema.ts`**

Insert a new group immediately after the existing "Memory / RAG" group (which currently ends with the `AGENT_MEMORY_RERANK` entry, right before the `// --- Verification / anti-hallucination` comment):
```typescript
  // --- Session persistence (src/session/*, Slice 30b Phase 6) ---
  {
    env: 'AGENT_SESSIONS_PATH',
    kind: 'string',
    def: 'sessions',
    doc: 'Directory for the session/chat-history SQLite store (session/store.ts createSessionStore), mirroring AGENT_MEMORY_PATH.',
  },
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/config/schema.test.ts`
Expected: PASS (all 6 tests).

- [ ] **Step 5: Run the full config suite (regression check)**

Run: `bun test tests/config/`
Expected: PASS — a new, independent `CONFIG_SPEC` entry cannot change any other entry's coercion.

- [ ] **Step 6: Gate + commit**

```bash
bun run typecheck && bun run lint:file -- src/config/schema.ts tests/config/schema.test.ts
git add src/config/schema.ts tests/config/schema.test.ts
git commit -m "feat(config): add AGENT_SESSIONS_PATH knob (Phase 6 Incr 1)"
```

---

