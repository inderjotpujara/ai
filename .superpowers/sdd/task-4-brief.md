### Task 4: Thread `runtime`/`provider` through discovery + selection consumers

**Files:**
- Modify: `src/discovery/huggingface-mlx.ts:63,89`, `src/discovery/huggingface-gguf.ts`
- Modify: `src/provisioning/catalog/hf-catalog.ts:49`
- Modify: `src/cli/select-hook.ts:47,50`, `src/resource/model-manager.ts:37`, `src/discovery/build-registry.ts:40`, `src/discovery/discover.ts:75`
- Modify: tests hardcoding `ProviderKind.MlxServer`: `tests/discovery/huggingface-mlx.test.ts:13,49`, `tests/runtime/mlx-server.test.ts:6,8`, `tests/cli/select-hook.test.ts:29`
- Test: full suite is the regression gate here.

**Interfaces:**
- Consumes: `RuntimeKind`, `ProviderKind`, `downloadKindFor` (Tasks 1-3).
- Produces: discovered `ModelDeclaration`s carry `runtime`; `Candidate`s carry `provider` set via `downloadKindFor(runtime, shape)`.

- [ ] **Step 1: Update discovery to set both kinds**

In `src/discovery/huggingface-mlx.ts`: set discovered declarations' `runtime: RuntimeKind.MlxServer`; when producing a `Candidate`, set `provider: downloadKindFor(RuntimeKind.MlxServer, 'snapshot')` (= `HfSnapshot`). Change the host gate at :89 to `host.runtimes.includes(RuntimeKind.MlxServer)`.
In `src/discovery/huggingface-gguf.ts`: single-file GGUF → `runtime: RuntimeKind.Ollama`, `provider: downloadKindFor(RuntimeKind.Ollama, 'gguf-file')` (= `HfGguf`).

- [ ] **Step 2: Update `hf-catalog.ts:49` filter**

`kind === ProviderKind.HfSnapshot ? 'mlx' : 'gguf'` (the catalog source is now created with `HfSnapshot`).

- [ ] **Step 3: Update selection/manager consumers**

- `src/cli/select-hook.ts:47`: `runtimeFor(decl.runtime).createModel(decl)`.
- `src/cli/select-hook.ts:50`: `numCtx: decl.runtime === RuntimeKind.Ollama ? numCtx : undefined` (WS3 revisits this).
- `src/resource/model-manager.ts:37`: `controlFor: (decl) => runtimeFor(decl.runtime).control`.
- `src/discovery/build-registry.ts:40`: `runtimeFor(decl.runtime).control.isInstalled(...)`.
- `src/discovery/discover.ts:75`: pull via `providerFor(downloadKindFor(decl.runtime, shape))` OR the runtime's own control — match existing intent (Ollama pulls via runtime control; MLX/HF via `providerFor`). Where `discover.ts` currently does `runtimeFor(provider).control.pull`, keep runtime-control pull for Ollama; for MLX route the *download* via `providerFor`.

- [ ] **Step 4: Update the hardcoded-kind tests**

Replace `ProviderKind.MlxServer` with `RuntimeKind.MlxServer` in runtime/discovery/select-hook tests; where a test builds a `ModelDeclaration`, use `runtime:` not `provider:`; where a host lists runtimes, use `RuntimeKind`.

- [ ] **Step 5: Run typecheck + full suite (regression gate)**

Run: `bun run typecheck` then `bun test`
Expected: typecheck clean; suite green (the pre-Slice-18 count, adjusted for the 3 new tiny tests). Any residual `ProviderKind`↔`RuntimeKind` mismatch is a compile error — fix at the reported site.

- [ ] **Step 6: Commit**

```bash
git add src/discovery/ src/cli/select-hook.ts src/resource/model-manager.ts src/provisioning/catalog/hf-catalog.ts tests/
git commit -m "refactor: thread RuntimeKind (inference) + ProviderKind (download) through discovery + selection"
```

**WS1 checkpoint:** `bun run typecheck && bun test` fully green; Ollama paths unchanged (invariant).

---

## WS2 — hf-fetch real disk download

