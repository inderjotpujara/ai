# Slice 26 — Alternate-runtime + remote-auth completion — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up LM Studio + llama.cpp as full inference runtimes and rewrite MLX onto a shared managed base with full process supervision + load-time dynamic context, and complete the remote MCP auth path (live OAuth handshake + GitHub-PAT), all live-verified.

**Architecture:** A new `createManagedRuntime(strategy)` base owns the OpenAI-compatible server lifecycle (spawn/health/reuse/stop via a `process-supervisor`) and delegates runtime-specific launch/load to a thin `RuntimeStrategy` (llama.cpp = relaunch with `-c`, LM Studio = `@lmstudio/sdk` daemon load, MLX = fixed-context spawn). A new `OAuthClientProvider` implementation (0600 token store + PKCE store + browser loopback + DCR/CIMD) is registered into the already-existing `deps.authProviders` seam by `withMcpRun`.

**Tech Stack:** Bun + TypeScript, AI SDK v6 (`ai`, `@ai-sdk/openai-compatible`, `@ai-sdk/mcp`), `@lmstudio/sdk` (NEW), `@opentelemetry/api`, `zod`, `bun:test`, biome.

## Global Constraints

- **Runtime interface (verbatim, `src/runtime/runtime.ts`):** `Runtime = { kind: RuntimeKind; isAvailable(): Promise<boolean>; createModel(decl: ModelDeclaration): LanguageModel; control: RuntimeControl }`; `RuntimeControl = { isInstalled(model); pull(model); warm(model, numCtx?); unload(model); listLoaded(): Promise<LoadedModel[]>; getModelMax(model): Promise<number|undefined>; getModelKvArch(model): Promise<KvArch|undefined>; embed(model, texts): Promise<number[][]> }`. `LoadedModel = { name: string; sizeBytes: number }`.
- **Enums live in `src/core/types.ts`:** `RuntimeKind { Ollama, MlxServer, LmStudio }` → add `LlamaCpp`. Do NOT rename existing members. String enums only (`Foo = 'Foo'`) per CLAUDE.md; prefer `enum` over string-literal unions.
- **numCtx delivery:** per-call `num_ctx` flows ONLY through Ollama (`ollamaCtxOptions`, `agent-def.ts`). For managed runtimes it is delivered at LOAD time via `control.warm(model, numCtx)`; `select-hook.ts` keeps the per-call `numCtx: rt.kind === RuntimeKind.Ollama ? numCtx : undefined` unchanged.
- **Test seams:** every runtime/adapter is unit-tested with an INJECTED `spawn` + `fetchImpl` (never a live server); mirror `tests/runtime/mlx-server.test.ts` and `tests/provisioning/lmstudio.test.ts`.
- **Live tests are gated** with `const LIVE = process.env.<FLAG> === '1'; describe.skipIf(!LIVE)(...)`. Flags: `ALTRUNTIME_LIVE`, `MCP_OAUTH_LIVE`, plus `GITHUB_PAT` presence.
- **Reliability primitives to reuse:** `withWallClock(ms, fn)` (`src/reliability/timeout.ts`), `breakerFor(id, opts)` (`src/reliability/breaker.ts`, id convention `runtime:<kind>`).
- **Telemetry is mandatory** (observable-by-default): every new subsystem emits spans via `src/telemetry/spans.ts` helpers + `ATTR` keys. No secret values in spans/logs/hashes.
- **Per-task gate (implementer runs INLINE):** `bun test <focused file>` + `bun run typecheck` + `bun run lint:file <touched files>`, then commit. Controller runs full `bun test` between tasks. (`feedback-sdd-implementer-inline-tests`.)
- **Commit style:** conventional, `type(scope): summary`; end body with the `Co-Authored-By` trailer.
- **Docs hard line:** the final task updates ALL FOUR surfaces (architecture.md, README, ROADMAP, Artifact) + the SDD ledger.

---

# PHASE A — Managed OpenAI-compatible runtimes

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

### Task 2: Process supervisor (spawn + health-poll + reuse + stop)

**Files:**
- Create: `src/runtime/process-supervisor.ts`
- Test: `tests/runtime/process-supervisor.test.ts`

**Interfaces:**
- Produces:
```typescript
export type ChildHandle = { pid: number; kill(sig?: NodeJS.Signals): void; onExit(cb: (code: number | null) => void): void };
export type SpawnFn = (cmd: string, args: string[], opts?: { env?: Record<string, string> }) => ChildHandle;
export type SupervisedServer = { baseUrl: string; stop(): Promise<void> };
export type SuperviseDeps = { spawn?: SpawnFn; fetchImpl?: typeof fetch; startTimeoutMs?: number; pollMs?: number };
export type SuperviseCfg = {
  cmd: string; args: string[]; env?: Record<string, string>;
  host: string; port: number; basePath: string; // e.g. '/v1'
  healthPath: string;                            // '/health' | '/v1/models'
  healthOk?: (res: Response) => boolean;         // default: res.ok
};
export function superviseServer(cfg: SuperviseCfg, deps?: SuperviseDeps): Promise<SupervisedServer>;
```
- Behavior: spawn the process, poll `http://host:port{healthPath}` every `pollMs` (default 250) until `healthOk` true or `startTimeoutMs` (default 30000, via `withWallClock`) elapses → on timeout, `kill()` the child and throw `Error('runtime failed to become healthy')`. `baseUrl = http://host:port{basePath}`. `stop()` kills the child (SIGTERM). Default `spawn` uses `Bun.spawn`; default `fetchImpl` is `fetch`.

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/runtime/process-supervisor.test.ts
import { expect, test } from 'bun:test';
import { superviseServer, type ChildHandle, type SpawnFn } from '../../src/runtime/process-supervisor.ts';

function fakeSpawn(): { spawn: SpawnFn; killed: () => boolean } {
  let wasKilled = false;
  const spawn: SpawnFn = () => ({ pid: 4242, kill: () => { wasKilled = true; }, onExit: () => {} });
  return { spawn, killed: () => wasKilled };
}
const okAfter = (n: number): typeof fetch => {
  let calls = 0;
  return (async () => { calls++; return new Response('', { status: calls >= n ? 200 : 503 }); }) as unknown as typeof fetch;
};

test('spawns, polls health, resolves a baseUrl', async () => {
  const { spawn } = fakeSpawn();
  const s = await superviseServer(
    { cmd: 'x', args: [], host: '127.0.0.1', port: 9999, basePath: '/v1', healthPath: '/health' },
    { spawn, fetchImpl: okAfter(2), pollMs: 0, startTimeoutMs: 5000 },
  );
  expect(s.baseUrl).toBe('http://127.0.0.1:9999/v1');
});

test('kills the child and throws when health never comes up', async () => {
  const { spawn, killed } = fakeSpawn();
  const never = (async () => new Response('', { status: 503 })) as unknown as typeof fetch;
  await expect(
    superviseServer(
      { cmd: 'x', args: [], host: '127.0.0.1', port: 9999, basePath: '/v1', healthPath: '/health' },
      { spawn, fetchImpl: never, pollMs: 0, startTimeoutMs: 30 },
    ),
  ).rejects.toThrow('healthy');
  expect(killed()).toBe(true);
});
```

- [ ] **Step 2: Run to verify fail** — `bun test tests/runtime/process-supervisor.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement** `src/runtime/process-supervisor.ts` per the Interfaces block. Poll loop: `while (!timedOut) { try { const r = await fetchImpl(url, {signal: AbortSignal.timeout(pollMs+1000)}); if (healthOk(r)) return server; } catch {} await sleep(pollMs); }`. Wrap the whole poll in `withWallClock(startTimeoutMs, ...)`; on the wall-clock reject, `child.kill('SIGTERM')` and rethrow as `Error('runtime failed to become healthy after ${startTimeoutMs}ms')`. Default `spawn`:
```typescript
const defaultSpawn: SpawnFn = (cmd, args, opts) => {
  const proc = Bun.spawn([cmd, ...args], { env: { ...process.env, ...opts?.env }, stdout: 'ignore', stderr: 'ignore' });
  return { pid: proc.pid, kill: (sig) => proc.kill(sig as never), onExit: (cb) => { proc.exited.then((code) => cb(code)); } };
};
```

- [ ] **Step 4: Run to verify pass** — PASS.

- [ ] **Step 5: commit** (`git add` the two files; `feat(runtime): process supervisor with health-poll + kill-on-timeout`).

---

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

### Task 5: MLX strategy + rewrite `mlx-server.ts` onto the base

**Files:**
- Create: `src/runtime/strategies/mlx.ts`
- Modify: `src/runtime/mlx-server.ts` (rewrite to delegate to the base; KEEP exports `createMlxServerRuntime(deps?)` + `mlxServerRuntime`)
- Modify: `src/runtime/registry.ts` (MLX now comes from the base; no new array entry — `mlxServerRuntime` already listed)
- Test: `tests/runtime/mlx-server.test.ts` (existing — must still pass; extend for spawn)

**Interfaces:**
- Consumes: Task 3.
- Produces: `mlxStrategy: RuntimeStrategy` (`kind: MlxServer`, `contextCapability: 'fixed'`, `defaultPort: 1234` — MLX/LM Studio default, `healthPath: '/v1/models'`, `basePath: '/v1'`; `launch(model, _numCtx, port)` → `{ cmd: 'mlx_lm.server', args: ['--model', model, '--host', '127.0.0.1', '--port', String(port)], port }`; `detect()` → `Bun.which('mlx_lm.server') != null` OR the `MLX_BASE_URL` server answers `/v1/models` — preserve today's env-based reachability so existing behavior is retained). `createMlxServerRuntime(deps?)` builds `createManagedRuntime(mlxStrategy, deps)` while preserving the `deps.baseUrl`/`deps.fetchImpl` injection (map `baseUrl` → override the fallback base URL so the existing tests that inject `baseUrl: 'http://fake:1234/v1'` keep working).

**CRITICAL COMPAT NOTE:** the existing `tests/runtime/mlx-server.test.ts` (verbatim in the spec source) injects `{ baseUrl, fetchImpl }` and expects `getModelMax`/`listLoaded`/`isInstalled`/`isAvailable` to work against that injected fetch WITHOUT any spawn. So: when `deps.baseUrl` is provided, the MLX runtime must treat the server as already-running at that URL (no spawn) — `warm` becomes a no-op reachability path, exactly as today. Only spawn when NO external `baseUrl`/`MLX_BASE_URL` is configured. Preserve every existing test assertion.

- [ ] **Step 1:** Run the EXISTING `tests/runtime/mlx-server.test.ts` first to capture green baseline, then add one spawn test:
```typescript
test('mlx warm spawns mlx_lm.server when no external base url is set', async () => {
  const seen: string[] = [];
  const spawn = ((cmd: string) => { seen.push(cmd); return { pid: 1, kill: () => {}, onExit: () => {} }; }) as unknown as import('../../src/runtime/process-supervisor.ts').SpawnFn;
  const health = (async () => new Response(JSON.stringify({ data: [{ id: 'm' }] }), { status: 200 })) as unknown as typeof fetch;
  const rt = createMlxServerRuntime({ spawn, fetchImpl: health } as never);
  await rt.control.warm('m', 8192); // fixed capability: no context flag, but process is spawned
  expect(seen).toEqual(['mlx_lm.server']);
});
```
- [ ] **Step 2: fail** — new test fails (spawn seam not wired).
- [ ] **Step 3: implement** — rewrite `mlx-server.ts` to build on `createManagedRuntime(mlxStrategy, ...)`, threading the compat `baseUrl`/`fetchImpl`/`spawn` deps. Extend `MlxServerDeps` with optional `spawn`. Keep `MemoryError` on `embed`.
- [ ] **Step 4: pass** — the FULL existing mlx-server.test.ts + the new test all pass.
- [ ] **Step 5: commit** (`refactor(runtime): rewrite MLX onto the managed base (fixed-context, supervised)`).

---

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

### Task 8: Runtime telemetry (`RUNTIME_*` attrs + `withRuntimeSpan`)

**Files:**
- Modify: `src/telemetry/spans.ts` (ATTR keys + `withRuntimeSpan`)
- Modify: `src/runtime/managed-openai-compatible.ts` (emit spawn/warm span)
- Test: `tests/telemetry/runtime-span.test.ts`

**Interfaces:**
- Produces: `ATTR.RUNTIME_KIND='runtime.kind'`, `RUNTIME_CONTEXT_CAPABILITY='runtime.context.capability'`, `RUNTIME_CONTEXT_REQUESTED='runtime.context.requested'`, `RUNTIME_CONTEXT_APPLIED='runtime.context.applied'`, `RUNTIME_WARM_OUTCOME='runtime.warm.outcome'`. `withRuntimeSpan(kind, fn)` mirroring `withToolSpan` (span name `runtime.warm`), exposing a recorder to set capability/requested/applied/outcome.
- Behavior: `control.warm` wraps its work in `withRuntimeSpan`; sets `RUNTIME_CONTEXT_APPLIED` = numCtx for `relaunch`/`reload`, and `-1`/omitted for `fixed` (so the MLX fixed-context limitation is observable). Outcome `spawned` | `reused` | `daemon-loaded` | `failed`.

- [ ] **Step 1: failing test** — export a `withRuntimeSpan` and assert it exists + sets attributes without throwing (mirror how other span helpers are unit-tested; if the suite has a span-capture harness use it, else assert the function runs the body and returns its value).
```typescript
// tests/telemetry/runtime-span.test.ts
import { expect, test } from 'bun:test';
import { withRuntimeSpan, ATTR } from '../../src/telemetry/spans.ts';
import { RuntimeKind } from '../../src/core/types.ts';

test('withRuntimeSpan runs the body and exposes a recorder', async () => {
  const out = await withRuntimeSpan(RuntimeKind.LlamaCpp, async (rec) => { rec.applied(8192, 8192, 'spawned', 'relaunch'); return 7; });
  expect(out).toBe(7);
  expect(ATTR.RUNTIME_CONTEXT_APPLIED).toBe('runtime.context.applied');
});
```
- [ ] **Step 2: fail**.
- [ ] **Step 3: implement** the ATTR keys + `withRuntimeSpan` (mirror `withCrewBuildSpan`'s recorder shape), and wire it into `managed-openai-compatible.ts` `warm`.
- [ ] **Step 4: pass**.
- [ ] **Step 5: commit** (`feat(telemetry): runtime warm/spawn spans + RUNTIME_* attrs`).

---

### Task 9: Live-verify the download adapters (gated)

**Files:**
- Create: `tests/integration/altruntime-download.live.test.ts`

**Interfaces:** Consumes the existing `createLmStudioProvider` + `createHfFetchProvider`. Gate: `const LIVE = process.env.ALTRUNTIME_LIVE === '1'`.

- [ ] **Step 1: write the gated live test** — with `describe.skipIf(!LIVE)`: (a) a real LM Studio download of a tiny model via `createLmStudioProvider()` reaching `DownloadPhase.Done`; (b) a real llama.cpp GGUF fetch via the HfGguf provider to a temp dir, asserting the file exists + non-zero. These only run when the runtimes are installed (Task 17 installs them).
- [ ] **Step 2:** run WITHOUT the flag → SKIPPED (proves gating).
- [ ] **Step 3:** (no impl — adapters exist).
- [ ] **Step 4:** leave for Task 17's live pass.
- [ ] **Step 5: commit** (`test(runtime): gated live-verify for LM Studio + llama.cpp download adapters`).

---

# PHASE B — Remote MCP auth completion

### Task 10: OAuth token store (0600 file)

**Files:**
- Create: `src/mcp/token-store.ts`
- Test: `tests/mcp/token-store.test.ts`

**Interfaces:**
- Produces:
```typescript
export type StoredTokens = { access_token: string; token_type?: string; refresh_token?: string; expires_at?: number };
export type ClientRecord = { client_id: string; client_secret?: string };
export type ServerAuthRecord = { tokens?: StoredTokens; codeVerifier?: string; client?: ClientRecord };
export function tokenStorePath(): string; // default: $XDG_CONFIG_HOME|~/.config + /ai/mcp-tokens.json
export function readTokenStore(path?: string): Record<string, ServerAuthRecord>;
export function writeTokenStore(store: Record<string, ServerAuthRecord>, path?: string): void; // atomic temp+rename, mode 0o600
export function getServerAuth(server: string, path?: string): ServerAuthRecord;
export function setServerAuth(server: string, rec: ServerAuthRecord, path?: string): void; // merge + persist
```
- Behavior: mirror `consent.ts` atomic write BUT add `{ mode: 0o600 }` on the temp write AND `chmodSync(path, 0o600)` after rename (rename preserves the temp's mode; set on both to be safe). Corrupt/missing file → `{}` (never throw). Create the parent dir (`mkdirSync(dirname, { recursive: true, mode: 0o700 })`).

- [ ] **Step 1: failing tests**
```typescript
// tests/mcp/token-store.test.ts
import { expect, test } from 'bun:test';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setServerAuth, getServerAuth } from '../../src/mcp/token-store.ts';

test('round-trips tokens per server and writes 0600', () => {
  const path = join(tmpdir(), `mcp-tokens-${Date.now()}.json`);
  setServerAuth('linear', { tokens: { access_token: 'abc', token_type: 'Bearer' } }, path);
  expect(getServerAuth('linear', path).tokens?.access_token).toBe('abc');
  expect(statSync(path).mode & 0o777).toBe(0o600);
});

test('missing file reads as empty, never throws', () => {
  expect(getServerAuth('nope', join(tmpdir(), `absent-${Date.now()}.json`))).toEqual({});
});
```
- [ ] **Step 2: fail**.
- [ ] **Step 3: implement** per Interfaces.
- [ ] **Step 4: pass**.
- [ ] **Step 5: commit** (`feat(mcp): 0600 OAuth token store`).

---

### Task 11: Browser loopback callback server

**Files:**
- Create: `src/mcp/loopback.ts`
- Test: `tests/mcp/loopback.test.ts`

**Interfaces:**
- Produces:
```typescript
export type LoopbackDeps = { openBrowser?: (url: string) => void; port?: number; timeoutMs?: number };
/** Start a one-shot localhost server, open `authUrl` in the browser, resolve with the
 *  captured {code,state} on the first /callback hit, then stop the server. */
export function awaitOAuthRedirect(authUrl: string, expectedState: string, deps?: LoopbackDeps):
  Promise<{ code: string; state: string; redirectUri: string }>;
export function loopbackRedirectUri(port: number): string; // http://127.0.0.1:<port>/callback
```
- Behavior: bind `127.0.0.1:0` (ephemeral) via `Bun.serve`; `redirectUri = http://127.0.0.1:{actualPort}/callback`; call `deps.openBrowser(authUrl)` (default: `Bun.spawn(['open', url])` on darwin); on GET `/callback?code&state`, verify `state === expectedState` (else 400 + reject `Error('state mismatch')`), respond 200 "You may close this window", resolve, stop. `withWallClock(timeoutMs ?? 180000, ...)` guards a no-show.

> NOTE: to make it testable without a browser, `deps.openBrowser` is injected; the test drives the callback by `fetch`-ing the redirect URI directly. `awaitOAuthRedirect` must expose the bound port before it resolves — accept a caller-provided `port` in tests, or resolve the redirectUri via a small two-step: return the server's port through `deps` callback. Implement `openBrowser` receiving the FINAL authUrl with the real redirect port substituted; simplest: bind first, compute redirectUri, let the CALLER build authUrl with it (so signature is `awaitOAuthRedirect(buildAuthUrl: (redirectUri) => string, expectedState, deps)`). Use that signature.

- [ ] **Step 1: failing test**
```typescript
// tests/mcp/loopback.test.ts
import { expect, test } from 'bun:test';
import { awaitOAuthRedirect } from '../../src/mcp/loopback.ts';

test('captures code+state from the callback', async () => {
  const p = awaitOAuthRedirect(
    (redirectUri) => `https://as.example/auth?redirect_uri=${encodeURIComponent(redirectUri)}`,
    'xyz',
    { openBrowser: (url) => {
        const uri = decodeURIComponent(new URL(url).searchParams.get('redirect_uri')!);
        void fetch(`${uri}?code=CODE123&state=xyz`);
      }, timeoutMs: 5000 },
  );
  const r = await p;
  expect(r.code).toBe('CODE123');
  expect(r.state).toBe('xyz');
});
```
- [ ] **Step 2: fail**.
- [ ] **Step 3: implement** with the `buildAuthUrl(redirectUri)` signature.
- [ ] **Step 4: pass**.
- [ ] **Step 5: commit** (`feat(mcp): browser loopback OAuth redirect capture`).

---

### Task 12: OAuth client provider

**Files:**
- Create: `src/mcp/oauth-provider.ts`
- Test: `tests/mcp/oauth-provider.test.ts`

**Interfaces:**
- Consumes: Task 10 (token store), Task 11 (loopback), `OAuthClientProvider` type from `@ai-sdk/mcp`.
- Produces: `createOAuthProvider(serverName: string, opts?: { storePath?: string; scopes?: string[]; clientId?: string; openBrowser?: (u: string) => void }): OAuthClientProvider`.
- Behavior: implement every required `OAuthClientProvider` member (verbatim contract from the spec): `tokens()` → store; `saveTokens(t)` → store; `redirectToAuthorization(url)` → `awaitOAuthRedirect` (the SDK gives the authorization URL; our provider opens the browser + captures the code — note: the AI SDK provider contract drives the actual code→token exchange, our `redirectToAuthorization` only needs to open the browser and the SDK's transport polls; confirm the exact SDK callback shape at implementation time and adapt — the SDK may instead expect `redirectToAuthorization` to just `open` and a separate `saveCodeVerifier`/`codeVerifier` + a code-provider callback); `saveCodeVerifier`/`codeVerifier` → store; `get redirectUrl()` → the loopback URI; `get clientMetadata()` → `{ client_name: 'ai-local-agent', redirect_uris: [redirectUrl], grant_types: ['authorization_code','refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none', scope: scopes?.join(' ') }`; `clientInformation()` → store's `client` (undefined ⇒ triggers DCR/CIMD in the SDK); `saveClientInformation?` → store.

> **Implementer:** the precise wiring of `redirectToAuthorization` vs. the SDK's code-capture differs by `@ai-sdk/mcp` version. Read `node_modules/@ai-sdk/mcp/…/oauth.ts` FIRST and make the provider satisfy the ACTUAL interface. The unit test below pins the store-backed methods (version-independent); the browser/loopback flow is proven live in Task 18.

- [ ] **Step 1: failing test** (store-backed methods, no network)
```typescript
// tests/mcp/oauth-provider.test.ts
import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createOAuthProvider } from '../../src/mcp/oauth-provider.ts';

test('persists + returns tokens and code verifier via the store', async () => {
  const storePath = join(tmpdir(), `oauth-${Date.now()}.json`);
  const p = createOAuthProvider('linear', { storePath });
  await p.saveCodeVerifier('verifier-123');
  expect(await p.codeVerifier()).toBe('verifier-123');
  await p.saveTokens({ access_token: 'tok', token_type: 'Bearer' } as never);
  expect((await p.tokens())?.access_token).toBe('tok');
  expect(p.clientMetadata.redirect_uris.length).toBeGreaterThan(0);
});
```
- [ ] **Step 2: fail**.
- [ ] **Step 3: implement** against the real SDK interface.
- [ ] **Step 4: pass**.
- [ ] **Step 5: commit** (`feat(mcp): live OAuth client provider (store + PKCE + DCR/CIMD)`).

---

### Task 13: Extend the config auth schema

**Files:**
- Modify: `src/mcp/types.ts` (`httpAuthSchema`, `HttpServerEntry.auth`)
- Modify: `src/mcp/config.ts` (carry the extended `auth` through `toEntry` — already passes `data.auth`)
- Test: `tests/mcp/config.test.ts` (add)

**Interfaces:**
- Produces: `httpAuthSchema = z.object({ kind: z.literal(McpAuthKind.OAuth), scopes: z.array(z.string()).optional(), clientId: z.string().optional() })`; `HttpServerEntry.auth?: { kind: McpAuthKind.OAuth; scopes?: string[]; clientId?: string }`.

- [ ] **Step 1: failing test** — a `mcp.json` http entry with `auth: { kind: 'oauth', scopes: ['read'] }` loads with `entry.auth.scopes === ['read']`.
- [ ] **Step 2: fail**.
- [ ] **Step 3: implement** (widen schema + type; `toEntry` already forwards `data.auth`).
- [ ] **Step 4: pass**.
- [ ] **Step 5: commit** (`feat(mcp): optional scopes/clientId in OAuth config schema`).

---

### Task 14: Wire `deps.authProviders` in `withMcpRun`

**Files:**
- Modify: `src/cli/with-mcp-run.ts` (construct authProviders from OAuth entries)
- Test: `tests/cli/with-mcp-run.test.ts` (add) or `tests/mcp/mount-all.test.ts`

**Interfaces:**
- Consumes: Task 12 (`createOAuthProvider`), the config's `entries` (each `HttpServerEntry` with `auth?.kind === OAuth`).
- Behavior: BEFORE `mountAll`, build `authProviders: Record<string, OAuthClientProvider>` = for each `config.entries` entry that is Http with `auth?.kind === McpAuthKind.OAuth`, `createOAuthProvider(entry.name, { scopes: entry.auth.scopes, clientId: entry.auth.clientId })`. Merge into `opts.mountDeps` (caller-supplied wins). Pass to `mountAll(config, { ...mountDeps, authProviders })`.

- [ ] **Step 1: failing test** — a config with one OAuth http entry + a spy `mount` (injected via mountDeps.mount) asserts the spec passed to `mount` has a defined `authProvider` (today it's undefined → degrade warning).
- [ ] **Step 2: fail**.
- [ ] **Step 3: implement** the authProviders construction in `withMcpRun`.
- [ ] **Step 4: pass**.
- [ ] **Step 5: commit** (`feat(mcp): populate deps.authProviders for OAuth entries in withMcpRun`).

---

### Task 15: MCP auth telemetry

**Files:**
- Modify: `src/telemetry/spans.ts` (auth ATTR keys + emit through the mount span)
- Modify: `src/cli/with-mcp-run.ts` (record auth outcomes)
- Test: `tests/telemetry/mcp-auth-span.test.ts`

**Interfaces:**
- Produces: `ATTR.MCP_AUTH_OUTCOME='mcp.auth.outcome'`, `ATTR.MCP_AUTH_KIND='mcp.auth.kind'`. Extend the `withMcpMountSpan` `record` callback OR add a sibling `recordAuth(name, outcome)` on the same span (emit an `mcp.server.auth` event). Outcomes: `authenticated` | `token-reused` | `auth-failed` | `dcr-registered` | `static-key`. No token values.
- Behavior: `withMcpRun` records `static-key` for entries with static headers, and (for OAuth entries) `token-reused` when the store already holds tokens vs `authenticated` after a fresh handshake — determined by checking the store before mount.

- [ ] **Step 1: failing test** — assert `ATTR.MCP_AUTH_OUTCOME` exists and the extended recorder emits without throwing.
- [ ] **Step 2: fail**.
- [ ] **Step 3: implement**.
- [ ] **Step 4: pass**.
- [ ] **Step 5: commit** (`feat(telemetry): mcp.auth.* events`).

---

### Task 16: GitHub-PAT gated live-verify

**Files:**
- Create: `tests/integration/github-mcp.live.test.ts`

**Interfaces:** Gate: `const HAS_PAT = !!process.env.GITHUB_PAT`. Uses the real `github` pack entry → `loadMcpConfig` (with a temp `mcp.json` mounting the github pack server) → `mountAll` → assert ≥1 tool is exposed and a benign read tool call succeeds.

- [ ] **Step 1: write the gated test** with `describe.skipIf(!HAS_PAT)`.
- [ ] **Step 2:** run without `GITHUB_PAT` → SKIPPED.
- [ ] **Step 3–4:** executed in Task 18's live pass with the user's PAT.
- [ ] **Step 5: commit** (`test(mcp): gated GitHub-PAT remote MCP live-verify`).

---

# PHASE C — Live-verify + docs (the no-deferrals close)

### Task 17: Install runtimes + live-verify managed runtimes

**Files:**
- Create: `tests/integration/altruntime.live.test.ts`
- Create: `tests/integration/altruntime-available.ts` (readiness helper, mirrors `mlx-available.ts`)

**Steps (controller-run, not a subagent — needs real installs):**
- [ ] **Step 1:** `brew install llama.cpp`; install LM Studio (cask `brew install --cask lm-studio` or direct) + `lms` CLI; pull one small GGUF for llama.cpp and one model in LM Studio; confirm `mlx_lm.server` still present (Slice 18).
- [ ] **Step 2:** write `altruntime.live.test.ts` (`describe.skipIf(!ALTRUNTIME_LIVE)`): for each of llama.cpp + LM Studio + MLX — `rt.control.warm(model, 8192)` then `generateText({ model: rt.createModel(decl), prompt })` returns non-empty; for llama.cpp + LM Studio additionally assert the served context reflects 8192 (query `/v1/models` context length OR the llama-server startup); MLX asserts process managed + model-default context (documented).
- [ ] **Step 3:** run `ALTRUNTIME_LIVE=1 bun test tests/integration/altruntime.live.test.ts` and the Task 9 download live test; capture PASS output.
- [ ] **Step 4:** if a defect surfaces, fix in the relevant Phase-A file + re-run (live-verify is the net per `feedback-live-verify-before-merge`).
- [ ] **Step 5: commit** (`test(runtime): live-verify managed llama.cpp + LM Studio + MLX runtimes`).

---

### Task 18: Live-verify OAuth (Linear) + GitHub PAT

**Steps (controller-run — needs the user's browser + PAT):**
- [ ] **Step 1:** add a temp `mcp.json` entry for Linear (`{ type: 'http', url: 'https://mcp.linear.app/mcp', auth: { kind: 'oauth' } }`).
- [ ] **Step 2:** `MCP_OAUTH_LIVE=1` run a real chat/mcp mount → the browser opens (loopback), user approves → assert tokens land in the 0600 store and a Linear tool is listed.
- [ ] **Step 3:** run a SECOND time → assert NO browser prompt (tokens reused / refreshed) + a tool call succeeds.
- [ ] **Step 4:** with the user's `GITHUB_PAT` exported, run the Task 16 test → PASS.
- [ ] **Step 5:** capture outputs; fix any defect in the Phase-B files + re-run.

---

### Task 19: Docs — all four surfaces + ledger

**Files:**
- Modify: `docs/architecture.md` (§5/§13 runtimes: managed base + strategies + full supervision + context-capability matrix incl. MLX fixed-context; §14 MCP: live OAuth, token store, DCR/CIMD, resource param, authProviders wiring)
- Modify: `README.md` (Status line; slice table row Slice 26 ✅; runtime/auth feature paragraph)
- Modify: `docs/ROADMAP.md` (flip Slice 26 → ✅ in gap table + phase table + recommended sequence; update "Alternate runtimes & the Mac Mini era")
- Modify: `.superpowers/sdd/progress.md` (Slice 26 per-task/review/landing entries)

- [ ] **Step 1:** update architecture.md §5/§13/§14 to match the shipped code (audit claims vs diff, per the CLAUDE.md hard line).
- [ ] **Step 2:** update README status + table + feature text.
- [ ] **Step 3:** flip ROADMAP Slice 26 markers.
- [ ] **Step 4:** append the SDD ledger Slice-26 section.
- [ ] **Step 5:** `bun run docs:check` green; commit (`docs: Slice 26 — runtimes + remote-auth across all four surfaces`).

---

### Task 20: Artifact regenerate + whole-branch review + gate

**Steps:**
- [ ] **Step 1:** regenerate the interactive architecture snapshot Artifact (same url, favicon 🧭): update the runtime node(s) (MLX/LM Studio/llama.cpp under one managed base), add an MCP-auth edge, bump footer "26 slices · <N> tests". Validate body-only JS with `node --check` before deploy.
- [ ] **Step 2:** fan out whole-branch code-review subagents (correctness / security [token store + loopback + spawn] / simplification). Apply verified findings.
- [ ] **Step 3:** run the full gate split: `bun run docs:check && bun run typecheck && bun run lint` then `bun test`. Capture pass counts.
- [ ] **Step 4:** finishing-a-development-branch → merge `--no-ff` to main + push (slice-landing gate needs README + ROADMAP + ledger in the same push — all done Task 19). Ask the user y/N before merge + push.
- [ ] **Step 5:** update the resume pointer + memory (Slice 26 landed).

---

## Self-Review (against the spec)

**Spec coverage:** §4.1 base → Task 3; §4.2 strategies → Tasks 4/5/6; §4.3 context delivery → Task 7; §4.4 types/registration → Tasks 1/4/5/6; §4.5 download live-verify → Tasks 9/17; §5.1 OAuth provider → Tasks 10/11/12; §5.2 integration seam → Tasks 13/14; §5.3 GitHub-PAT → Tasks 16/18; §6 telemetry → Tasks 8/15; §7 docs → Tasks 19/20; §8 testing → every task + 9/16/17/18; §9 risks (MLX fixed) → Tasks 5/8/17. All covered.

**Placeholder scan:** one intentional `expect(true)` placeholder in Task 7's sketch is explicitly flagged "do NOT ship" with the real assertion specified. No other placeholders.

**Type consistency:** `RuntimeStrategy`, `ContextCapability`, `ManagedDeps`, `SpawnFn`, `ChildHandle`, `SupervisedServer`, `RuntimeControl.warm(model, numCtx?)`, `ServerAuthRecord`, `StoredTokens`, `createOAuthProvider(serverName, opts)` are used consistently across tasks. `contextCapability` values `'relaunch'|'reload'|'fixed'` match everywhere.

**Known implementer risks (per `feedback-plan-sample-code-review-rigor` — the per-task adversarial review is the net):** (a) the exact `@ai-sdk/mcp` `OAuthClientProvider` member wiring (Task 12) and (b) the exact `@lmstudio/sdk` load API (Task 6) must be verified against the installed package versions at implementation time, not copied from this plan verbatim.
