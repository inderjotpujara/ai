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

