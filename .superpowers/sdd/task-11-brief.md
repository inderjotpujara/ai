### Task 11: MLX control surface — real `isInstalled`/`listLoaded`/`getModelMax`

**Files:** Modify: `src/runtime/mlx-server.ts`; Test: `tests/runtime/mlx-server.test.ts` (extend, injecting a fake fetch).

**Interfaces:**
- Produces: `getModelMax(model)` returns a number when the server exposes it (else `undefined`); `listLoaded` returns real sizes when available; `pull` attempts a server-side load and degrades with a clear error.

- [ ] **Step 1: Write the failing test** — inject a fake `${BASE}/models` response exposing a context length / size; assert `getModelMax` returns it and `listLoaded` maps the id.
  (Refactor `mlx-server.ts` to accept an injectable `fetchImpl`/`baseUrl` via a `createMlxServerRuntime(deps)` factory so it's testable without a live server; export a default `mlxServerRuntime = createMlxServerRuntime()`.)
- [ ] **Step 2: Run to verify it fails.**
- [ ] **Step 3: Implement** the factory + fill `getModelMax`/`getModelKvArch` (return `undefined` when the server gives nothing — planner tolerates it), real `listLoaded` sizes when present, and a `pull` that checks `listIds()` then attempts the server's load endpoint if one exists, else throws the existing clear "load it in the server" error (degrade). Keep `embed` throwing `MemoryError` (honestly unsupported).
- [ ] **Step 4: Run to verify it passes.**
- [ ] **Step 5: Commit**

```bash
git add src/runtime/mlx-server.ts tests/runtime/mlx-server.test.ts
git commit -m "feat(runtime): fill MLX control surface (getModelMax, listLoaded, pull best-effort) via injectable factory"
```

---

