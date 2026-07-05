### Task 4: llama.cpp strategy + register

**Files:**
- Create: `src/runtime/strategies/llamacpp.ts`
- Modify: `src/runtime/registry.ts` (add `llamaCppRuntime`)
- Test: `tests/runtime/llamacpp.test.ts`

**Interfaces:**
- Consumes: Task 3 (`createManagedRuntime`, `RuntimeStrategy`).
- Produces: `export const llamaCppStrategy: RuntimeStrategy`; `export const llamaCppRuntime: Runtime = createManagedRuntime(llamaCppStrategy)`.
- Details: `kind: RuntimeKind.LlamaCpp`, `contextCapability: 'relaunch'`, `defaultPort: 8080`, `healthPath: '/health'`, `basePath: '/v1'`. `detect()` → check `llama-server` on PATH (`Bun.which('llama-server') != null`; injectable via a `which` dep for tests). `launch(model, numCtx, port)` → `{ cmd: 'llama-server', args: ['-m', model, ...(numCtx ? ['-c', String(numCtx)] : []), '--host', '127.0.0.1', '--port', String(port)], port }`. Model may be a path OR an `-hf` repo id: if `model` contains `/` and not a filesystem path, use `['-hf', model]` instead of `['-m', model]` (document the heuristic).

- [ ] **Step 1: failing test**

```typescript
// tests/runtime/llamacpp.test.ts
import { expect, test } from 'bun:test';
import { RuntimeKind } from '../../src/core/types.ts';
import { llamaCppStrategy } from '../../src/runtime/strategies/llamacpp.ts';

test('llama.cpp launch sets -c to the requested context', () => {
  const spec = llamaCppStrategy.launch!('/models/q.gguf', 8192, 8080);
  expect(spec.args).toContain('-c');
  expect(spec.args[spec.args.indexOf('-c') + 1]).toBe('8192');
  expect(spec.args).toContain('--port');
});

test('llama.cpp uses -hf for a repo id, -m for a path', () => {
  expect(llamaCppStrategy.launch!('TheBloke/x-GGUF:Q4', 4096, 8080).args).toContain('-hf');
  expect(llamaCppStrategy.launch!('/abs/path.gguf', 4096, 8080).args).toContain('-m');
});

test('kind + capability + health path', () => {
  expect(llamaCppStrategy.kind).toBe(RuntimeKind.LlamaCpp);
  expect(llamaCppStrategy.contextCapability).toBe('relaunch');
  expect(llamaCppStrategy.healthPath).toBe('/health');
});
```

- [ ] **Step 2: fail** — module missing.
- [ ] **Step 3: implement** the strategy + `export const llamaCppRuntime`. In `registry.ts`, import and append `llamaCppRuntime` to `RUNTIMES`.
- [ ] **Step 4: pass**.
- [ ] **Step 5: commit** (`feat(runtime): llama.cpp inference runtime (relaunch -c dynamic context)`).

---

