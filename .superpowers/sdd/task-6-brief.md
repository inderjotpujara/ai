### Task 6: LM Studio strategy via `@lmstudio/sdk` + register

**Files:**
- Modify: `package.json` (add `@lmstudio/sdk` to dependencies — run `bun add @lmstudio/sdk`)
- Create: `src/runtime/strategies/lmstudio.ts`
- Modify: `src/runtime/registry.ts` (add `lmStudioRuntime`)
- Test: `tests/runtime/lmstudio-runtime.test.ts`

**Interfaces:**
- Produces: `lmStudioStrategy: RuntimeStrategy` (`kind: LmStudio`, `contextCapability: 'reload'`, `defaultPort: 1234`, `healthPath: '/v1/models'`; NO `launch`; `daemonLoad(model, numCtx)` uses `@lmstudio/sdk` (injectable client via a `deps` seam) to ensure the server is up and `client.llm.load(model, { config: { contextLength: numCtx } })`, returning `{ baseUrl: 'http://127.0.0.1:1234/v1' }`; `daemonUnload(model)` → `client.llm.unload(model)`; `detect()` → SDK client reachable / `lms` present). Wrap the SDK behind a small injectable interface `LmStudioClient = { load(model, ctx?): Promise<void>; unload(model): Promise<void>; listLoaded(): Promise<string[]>; reachable(): Promise<boolean> }` so tests use a fake and the real impl adapts `@lmstudio/sdk`.
- Consumes: Task 3.

- [ ] **Step 1: failing test** (fake `LmStudioClient`)

```typescript
// tests/runtime/lmstudio-runtime.test.ts
import { expect, test } from 'bun:test';
import { RuntimeKind } from '../../src/core/types.ts';
import { makeLmStudioStrategy, type LmStudioClient } from '../../src/runtime/strategies/lmstudio.ts';

function fakeClient(log: string[]): LmStudioClient {
  return {
    load: async (m, ctx) => { log.push(`load ${m} @ ${ctx}`); },
    unload: async (m) => { log.push(`unload ${m}`); },
    listLoaded: async () => ['m'],
    reachable: async () => true,
  };
}

test('daemonLoad loads the model at the requested context (reload capability)', async () => {
  const log: string[] = [];
  const strat = makeLmStudioStrategy(() => fakeClient(log));
  expect(strat.kind).toBe(RuntimeKind.LmStudio);
  expect(strat.contextCapability).toBe('reload');
  const r = await strat.daemonLoad!('m', 8192);
  expect(r.baseUrl).toBe('http://127.0.0.1:1234/v1');
  expect(log).toContain('load m @ 8192');
});
```

- [ ] **Step 2: fail**.
- [ ] **Step 3: implement** `makeLmStudioStrategy(getClient)` + a default `lmStudioStrategy` using the real `@lmstudio/sdk`-backed client + `export const lmStudioRuntime = createManagedRuntime(lmStudioStrategy)`. Append to `RUNTIMES`. The real client's `load` maps to `@lmstudio/sdk`'s `LMStudioClient().llm.model(model, { config: { contextLength } })` per its current API — verify the exact call in the SDK's types at implementation time; keep it isolated in this one file.
- [ ] **Step 4: pass**.
- [ ] **Step 5: commit** (`feat(runtime): LM Studio inference runtime via @lmstudio/sdk (reload context)`).

---

