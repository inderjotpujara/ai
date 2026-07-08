### Task 7: Serialize model-manager admission (eviction lock)

**Files:**
- Modify: `src/resource/model-manager.ts` (wrap `ensureReady` body in a per-manager async mutex)
- Create: `tests/resource/model-manager-lock.test.ts`

**Interfaces:**
- Consumes: existing `createModelManager(deps)` → `{ ensureReady, unloadAll }` (unchanged signature).
- Produces: `ensureReady` calls are serialized per manager instance — no two concurrent calls interleave the listLoaded→evict→warm section.

- [ ] **Step 1: Write the failing test**

```ts
// tests/resource/model-manager-lock.test.ts
import { expect, mock, test } from 'bun:test';
import { createModelManager } from '../../src/resource/model-manager.ts';
import type { ModelDeclaration } from '../../src/core/types.ts';

function decl(model: string): ModelDeclaration {
  return { runtime: 'ollama', model, params: { numCtx: 4096 }, role: 'general',
    footprint: { approxParamsBillions: 1, bytesPerWeight: 1 } } as ModelDeclaration;
}

test('concurrent ensureReady calls are serialized (warm never overlaps)', async () => {
  let active = 0, maxActive = 0;
  const control = {
    isInstalled: mock(async () => true),
    listLoaded: mock(async () => []),
    pull: mock(async () => {}), unload: mock(async () => {}),
    getModelMax: mock(async () => 8192), getModelKvArch: mock(async () => undefined),
    embed: mock(async () => []),
    warm: mock(async () => { active++; maxActive = Math.max(maxActive, active); await new Promise((r) => setTimeout(r, 20)); active--; }),
  };
  const m = createModelManager({ budgetBytes: 1e12, warn: () => {}, controlFor: () => control as never });
  await Promise.all([m.ensureReady(decl('a')), m.ensureReady(decl('b'))]);
  expect(maxActive).toBe(1);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test tests/resource/model-manager-lock.test.ts`
Expected: FAIL — `maxActive` is 2 (both admissions interleave).

- [ ] **Step 3: Implement a tiny promise-chain mutex**

At the top of `createModelManager` (near the per-instance maps ~`:49`):

```ts
  let admissionLock: Promise<unknown> = Promise.resolve();
  function serialize<T>(fn: () => Promise<T>): Promise<T> {
    const run = admissionLock.then(fn, fn);
    admissionLock = run.catch(() => {});
    return run;
  }
```

Rename the current `ensureReady` to `ensureReadyInner` and expose a wrapper:

```ts
  function ensureReady(decl: ModelDeclaration, opts: EnsureOpts = {}): Promise<number> {
    return serialize(() => ensureReadyInner(decl, opts));
  }
```

(`return { ensureReady, unloadAll };` stays.)

- [ ] **Step 4: Run tests + typecheck**

Run: `bun test tests/resource/ && bun run typecheck`
Expected: PASS (existing 25 model-manager tests still green; lock test passes).

- [ ] **Step 5: Commit**

```bash
git add src/resource/model-manager.ts tests/resource/model-manager-lock.test.ts
git commit -m "fix(resource): serialize model-manager admission (concurrent ensureReady raced eviction/VRAM budget)"
```

---

