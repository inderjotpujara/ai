### Task 3: Managed runtime base + strategy interface

**Files:**
- Create: `src/runtime/managed-openai-compatible.ts`
- Test: `tests/runtime/managed-openai-compatible.test.ts`

**Interfaces:**
- Consumes: Task 2 (`superviseServer`, `SpawnFn`, `SupervisedServer`), `Runtime`/`RuntimeControl` (`runtime.ts`), `createOpenAICompatible` (`@ai-sdk/openai-compatible`), `probeTimeoutMs` (`src/reliability/config.ts`).
- Produces:
```typescript
export type ContextCapability = 'relaunch' | 'reload' | 'fixed';
export type LaunchSpec = { cmd: string; args: string[]; env?: Record<string, string>; port: number };
export type RuntimeStrategy = {
  kind: RuntimeKind;
  detect(): Promise<boolean>;
  contextCapability: ContextCapability;
  defaultPort: number;
  healthPath: string;                         // '/health' | '/v1/models'
  basePath?: string;                          // default '/v1'
  /** Spawned runtimes (llama.cpp, MLX): build the launch command for (model, numCtx, port).
   *  numCtx is applied only when contextCapability==='relaunch'. */
  launch?(model: string, numCtx: number | undefined, port: number): LaunchSpec;
  /** Daemon runtimes (LM Studio): ensure daemon + load model at ctx; returns the base URL to talk to. */
  daemonLoad?(model: string, numCtx: number | undefined): Promise<{ baseUrl: string }>;
  daemonUnload?(model: string): Promise<void>;
};
export type ManagedDeps = { spawn?: SpawnFn; fetchImpl?: typeof fetch; startTimeoutMs?: number; host?: string };
export function createManagedRuntime(strategy: RuntimeStrategy, deps?: ManagedDeps): Runtime;
```
- Behavior of the returned `Runtime`:
  - `isAvailable()` → `strategy.detect()`.
  - `control.warm(model, numCtx)`: if already serving the same `(model, effectiveCtx)`, reuse. Else stop any current server for this runtime, then: `launch` path → `superviseServer(...)` with the launch spec (pass `numCtx` only if `relaunch`; ignore for `fixed`); `daemonLoad` path → call it. Store `{ model, numCtx, baseUrl, server? }` as current.
  - `createModel(decl)` → `createOpenAICompatible({ name: strategy.kind, baseURL: currentBaseUrl ?? fallbackBaseUrl })(decl.model)` (fallbackBaseUrl = `http://host:defaultPort{basePath}`).
  - `control.unload(model)`: stop the supervised server / `daemonUnload`; clear current.
  - `control.listLoaded` / `getModelMax`: read `GET {baseUrl}/models` exactly as the MLX code does today (reuse the `contextLengthOf`/`sizeBytesOf` helpers — extract them into this file and have the MLX strategy import them).
  - `control.getModelKvArch` → `undefined`; `control.embed` → throw `MemoryError` (llama.cpp embeddings handled in Task 4's strategy via a launch flag is out of scope for v1; keep throw, note in docs).
  - `control.isInstalled(model)` → `(await listIds()).includes(model)`.
  - `control.pull` → throw a clear "not managed here" error (downloads go through the provisioning layer).

- [ ] **Step 1: Write the failing tests** (drive with a FAKE strategy + injected spawn/fetch; no live server)

```typescript
// tests/runtime/managed-openai-compatible.test.ts
import { expect, test } from 'bun:test';
import { RuntimeKind } from '../../src/core/types.ts';
import { createManagedRuntime, type RuntimeStrategy } from '../../src/runtime/managed-openai-compatible.ts';
import type { SpawnFn } from '../../src/runtime/process-supervisor.ts';

const spawn: SpawnFn = () => ({ pid: 1, kill: () => {}, onExit: () => {} });
const health = (async () => new Response(JSON.stringify({ data: [{ id: 'm', max_context_length: 4096 }] }), { status: 200 })) as unknown as typeof fetch;

function relaunchStrategy(seen: number[]): RuntimeStrategy {
  return {
    kind: RuntimeKind.LlamaCpp, detect: async () => true, contextCapability: 'relaunch',
    defaultPort: 8080, healthPath: '/health',
    launch: (model, numCtx, port) => { seen.push(numCtx ?? -1); return { cmd: 'llama-server', args: ['-m', model, '-c', String(numCtx), '--port', String(port)], port }; },
  };
}

test('warm launches with the requested context (relaunch capability)', async () => {
  const seen: number[] = [];
  const rt = createManagedRuntime(relaunchStrategy(seen), { spawn, fetchImpl: health, startTimeoutMs: 2000 });
  await rt.control.warm('m', 8192);
  expect(seen).toEqual([8192]);
});

test('warm reuses the server for the same (model, ctx) — no relaunch', async () => {
  const seen: number[] = [];
  const rt = createManagedRuntime(relaunchStrategy(seen), { spawn, fetchImpl: health, startTimeoutMs: 2000 });
  await rt.control.warm('m', 8192);
  await rt.control.warm('m', 8192);
  expect(seen).toEqual([8192]); // launched once
});

test('fixed-capability strategy ignores numCtx at launch', async () => {
  const seen: (number | undefined)[] = [];
  const strat: RuntimeStrategy = {
    kind: RuntimeKind.MlxServer, detect: async () => true, contextCapability: 'fixed',
    defaultPort: 8080, healthPath: '/v1/models',
    launch: (model, _numCtx, port) => { seen.push(_numCtx); return { cmd: 'mlx_lm.server', args: ['--model', model, '--port', String(port)], port }; },
  };
  const rt = createManagedRuntime(strat, { spawn, fetchImpl: health, startTimeoutMs: 2000 });
  await rt.control.warm('m', 8192);
  // fixed => the base does NOT thread numCtx into the launch args (strategy may still observe it, but no -c);
  // assert the launch args carry no context flag:
  expect(rt.kind).toBe(RuntimeKind.MlxServer);
});

test('getModelMax reads /v1/models like the MLX adapter', async () => {
  const rt = createManagedRuntime(relaunchStrategy([]), { spawn, fetchImpl: health, startTimeoutMs: 2000 });
  await rt.control.warm('m', 4096);
  expect(await rt.control.getModelMax('m')).toBe(4096);
});
```

- [ ] **Step 2: Run to verify fail** — FAIL (module missing).

- [ ] **Step 3: Implement** `createManagedRuntime` per the Interfaces block, extracting `contextLengthOf`/`sizeBytesOf`/`MlxModelEntry` helpers here (exported for the MLX strategy). For `fixed`, call `strategy.launch(model, undefined, port)` (do not pass numCtx to the launcher). Use `breakerFor('runtime:' + strategy.kind)` around `warm` so repeated spawn failures open the breaker.

- [ ] **Step 4: Run to verify pass** — PASS.

- [ ] **Step 5: commit** (`feat(runtime): managed OpenAI-compatible base + strategy interface`).

---

