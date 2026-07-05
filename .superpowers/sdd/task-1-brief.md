### Task 1: Add `RuntimeKind.LlamaCpp` + kind-map wiring

**Files:**
- Modify: `src/core/types.ts` (RuntimeKind enum + its LmStudio comment)
- Modify: `src/core/kind-map.ts` (downloadKindFor, runtimeKindFor)
- Test: `tests/core/kind-map.test.ts` (create if absent; else add cases)

**Interfaces:**
- Produces: `RuntimeKind.LlamaCpp = 'LlamaCpp'`; `downloadKindFor(RuntimeKind.LlamaCpp, 'gguf-file') → ProviderKind.HfGguf`; `runtimeKindFor` unchanged mapping (HfGguf still → Ollama by default — llama.cpp opts in via an explicit declaration, see Task 5 note).

- [ ] **Step 1: Write the failing test**

```typescript
// tests/core/kind-map.test.ts
import { expect, test } from 'bun:test';
import { ProviderKind, RuntimeKind } from '../../src/core/types.ts';
import { downloadKindFor } from '../../src/core/kind-map.ts';

test('llama.cpp GGUF downloads route to the HfGguf provider', () => {
  expect(downloadKindFor(RuntimeKind.LlamaCpp, 'gguf-file')).toBe(ProviderKind.HfGguf);
  expect(downloadKindFor(RuntimeKind.LlamaCpp, 'ollama')).toBe(ProviderKind.HfGguf);
});
```

- [ ] **Step 2: Run test to verify it fails** — `bun test tests/core/kind-map.test.ts` → FAIL (`LlamaCpp` undefined).

- [ ] **Step 3: Implement**

In `src/core/types.ts`, add to `RuntimeKind` (keep existing members):
```typescript
  LlamaCpp = 'LlamaCpp', // GGUF via a managed llama.cpp-server (-c dynamic context)
```
Update the `LmStudio` comment to drop "download-only in Slice 18" (it becomes a real runtime in Task 6).

In `src/core/kind-map.ts`, in `downloadKindFor`, before the `RuntimeKind.Ollama` fallthrough:
```typescript
  if (runtime === RuntimeKind.LlamaCpp) return ProviderKind.HfGguf;
```

- [ ] **Step 4: Run test to verify it passes** — `bun test tests/core/kind-map.test.ts` → PASS.

- [ ] **Step 5: typecheck + lint + commit**
```bash
bun run typecheck && bun run lint:file src/core/types.ts src/core/kind-map.ts tests/core/kind-map.test.ts
git add src/core/types.ts src/core/kind-map.ts tests/core/kind-map.test.ts
git commit -m "feat(runtime): add RuntimeKind.LlamaCpp + kind-map routing"
```

---

