### Task 3: Retype the inference runtime registry + `Runtime.kind`

**Files:**
- Modify: `src/runtime/runtime.ts:22` (`Runtime.kind: RuntimeKind`)
- Modify: `src/runtime/registry.ts` (`runtimeFor(kind: RuntimeKind)`, :8-12)
- Modify: `src/runtime/mlx-server.ts:30` (`kind: RuntimeKind.MlxServer`)
- Modify: `src/runtime/ollama.ts` (`kind: RuntimeKind.Ollama`)
- Test: `tests/runtime/registry.test.ts` *(new)*

**Interfaces:**
- Consumes: `RuntimeKind` (Task 1).
- Produces: `runtimeFor(kind: RuntimeKind): Runtime`; `Runtime.kind: RuntimeKind`.

- [ ] **Step 1: Write the failing test** — `tests/runtime/registry.test.ts`

```ts
import { describe, expect, it } from 'bun:test';
import { RuntimeKind } from '../../src/core/types.ts';
import { runtimeFor } from '../../src/runtime/registry.ts';

describe('runtimeFor', () => {
  it('returns the Ollama runtime', () => {
    expect(runtimeFor(RuntimeKind.Ollama).kind).toBe(RuntimeKind.Ollama);
  });
  it('returns the MLX server runtime', () => {
    expect(runtimeFor(RuntimeKind.MlxServer).kind).toBe(RuntimeKind.MlxServer);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun run test:file -- "tests/runtime/registry.test.ts"`
Expected: FAIL — types/kinds mismatch.

- [ ] **Step 3: Edit the three runtime files**

- `src/runtime/runtime.ts`: `import { RuntimeKind }`; `kind: RuntimeKind` on the `Runtime` type.
- `src/runtime/registry.ts`: `runtimeFor(kind: RuntimeKind): Runtime` and `availableRuntimes` unchanged in body.
- `src/runtime/mlx-server.ts:4,30`: import `RuntimeKind`; `kind: RuntimeKind.MlxServer`.
- `src/runtime/ollama.ts`: import `RuntimeKind`; `kind: RuntimeKind.Ollama`.

- [ ] **Step 4: Run to verify it passes**

Run: `bun run test:file -- "tests/runtime/registry.test.ts"`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/runtime/ tests/runtime/registry.test.ts
git commit -m "feat(runtime): retype runtimeFor + Runtime.kind to RuntimeKind"
```

---

