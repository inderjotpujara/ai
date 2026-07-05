### Task 7: Deliver load-time context in `select-hook.ts`

**Files:**
- Modify: `src/cli/select-hook.ts` (warm managed runtimes with the computed numCtx before `createModel`)
- Test: `tests/cli/select-hook.test.ts` (existing — add a case; else create)

**Interfaces:**
- Consumes: `Runtime.control.warm`. The per-call `numCtx: rt.kind === RuntimeKind.Ollama ? numCtx : undefined` line stays. New: for a non-Ollama runtime that is available, call `await rt.control.warm(effectiveDecl.model, numCtx)` before `recordModelSelect`/`createModel`.

- [ ] **Step 1: failing test** — a fake runtime whose `control.warm` records the numCtx it was warmed with; assert select-hook warms it with the resolved ctx.

```typescript
// tests/cli/select-hook.test.ts (add)
import { expect, test } from 'bun:test';
import { RuntimeKind } from '../../src/core/types.ts';
import { createSelectHook } from '../../src/cli/select-hook.ts';
// ... build minimal deps: a registry with one non-Ollama decl, ensureReady stub returning ctx, and a fake runtimeFor
test('select-hook warms a managed runtime with the resolved context', async () => {
  const warmed: Array<[string, number | undefined]> = [];
  const fakeRt = {
    kind: RuntimeKind.LlamaCpp, isAvailable: async () => true,
    createModel: () => ({}) as never,
    control: { warm: async (m: string, c?: number) => { warmed.push([m, c]); }, isInstalled: async () => true, pull: async () => {}, unload: async () => {}, listLoaded: async () => [], getModelMax: async () => undefined, getModelKvArch: async () => undefined, embed: async () => [] },
  };
  // resolveModel is real; provide a registry decl with runtime=LlamaCpp and an ensureReady that returns e.g. 8192.
  // (Fill deps per the existing select-hook test harness in this file.)
  // Assert warmed[0] === ['<model>', 8192] after invoking the hook on an agent with a modelReq.
  expect(true).toBe(true); // replace with the real assertion using the harness
});
```
> NOTE to implementer: this file already has a select-hook harness (the runtime source shows `SelectHookDeps` + `runtimeFor` override). Reuse it; the assertion is `expect(warmed).toEqual([[effectiveModel, 8192]])`. Do NOT ship the placeholder `expect(true)`.

- [ ] **Step 2: fail** — warm not called.
- [ ] **Step 3: implement** — after the availability/degrade block, before `recordModelSelect`:
```typescript
      if (rt.kind !== RuntimeKind.Ollama) {
        await rt.control.warm(effectiveDecl.model, numCtx);
      }
```
(Ollama continues to warm via `ensureReady` inside `resolveModel`; managed runtimes warm here.)
- [ ] **Step 4: pass**.
- [ ] **Step 5: commit** (`feat(runtime): deliver load-time context to managed runtimes in select-hook`).

---

