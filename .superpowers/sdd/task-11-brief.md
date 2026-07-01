## Task 11: CLI (`bun run memory …`)

**Files:**
- Create: `src/cli/memory.ts`
- Modify: `package.json` (`"memory": "bun run src/cli/memory.ts"`)
- Test: `tests/cli/memory.test.ts`

**Interfaces:**
- Consumes: `createMemoryStore` (Task 9); the real embedder wiring from `src/memory/embed.ts` (Task 4) + Model Manager; mirror `src/cli/flow.ts` for lifecycle (telemetry init, args parse, `finally` close).
- Produces: a `runMemoryCli(argv: string[], deps): Promise<number>` (exit code) that is unit-testable with injected store deps.

- [ ] **Step 1: Write the failing test** (inject a fake store; assert command routing)
```ts
// tests/cli/memory.test.ts
import { describe, expect, test } from 'vitest';
import { runMemoryCli } from '../../src/cli/memory.ts';

function fakeStore() {
  const calls: string[] = [];
  return {
    calls,
    store: {
      remember: async () => { calls.push('remember'); },
      ingest: async () => { calls.push('ingest'); return { chunks: 2, skipped: false }; },
      recall: async () => { calls.push('recall'); return [{ id: 'a#0', text: 'hi', source: 'a', score: 0, namespace: '' }]; },
      reindex: async () => { calls.push('reindex'); },
      stats: async () => { calls.push('stats'); return { default: 3 }; },
      close: () => {},
    },
  };
}

describe('runMemoryCli', () => {
  test('recall routes to store.recall and returns 0', async () => {
    const f = fakeStore();
    const code = await runMemoryCli(['recall', 'apple'], { makeStore: () => f.store as any });
    expect(code).toBe(0);
    expect(f.calls).toContain('recall');
  });
  test('stats routes to store.stats', async () => {
    const f = fakeStore();
    await runMemoryCli(['stats'], { makeStore: () => f.store as any });
    expect(f.calls).toContain('stats');
  });
  test('unknown command returns non-zero', async () => {
    const f = fakeStore();
    expect(await runMemoryCli(['frobnicate'], { makeStore: () => f.store as any })).not.toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `bun test tests/cli/memory.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write `src/cli/memory.ts`** — parse subcommand + flags (`--space`, `--ns`, `--top`, `--embed`), call the store, print results. Provide `runMemoryCli(argv, deps)` with `deps.makeStore` defaulting to the real wiring (build embedder via Task 4 `makeEmbedder` + Model Manager, then `createMemoryStore`). Use `Date.now()` for the `at` timestamp at the CLI boundary (not in engine core). Mirror `src/cli/flow.ts` telemetry lifecycle + `finally { store.close() }`.
> Keep the real store construction behind `deps.makeStore` so the unit test injects a fake. The default `makeStore` reads timestamps + wires the Model Manager (see `src/cli/crew.ts`/`flow.ts` for how they build runtime deps).

- [ ] **Step 4: Add the npm script** to `package.json`: `"memory": "bun run src/cli/memory.ts"`.

- [ ] **Step 5: Run tests + typecheck**
Run: `bun test tests/cli/memory.test.ts && bun run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**
```bash
git add src/cli/memory.ts package.json tests/cli/memory.test.ts
git commit -m "feat(memory): bun run memory CLI (ingest/recall/stats/reindex)"
```

---

