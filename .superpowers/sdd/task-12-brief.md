### Task 12: MLX selection — opt-in + degrade-to-Ollama

**Files:** Modify: `src/cli/select-hook.ts` (:47-50); Test: `tests/cli/select-hook.test.ts`.

**Interfaces:**
- Produces: when `decl.runtime === RuntimeKind.MlxServer` but the MLX runtime `isAvailable()` is false, selection degrades to the Ollama runtime (logged), never throwing.

- [ ] **Step 1: Write the failing test** — a declaration with `runtime: MlxServer` + an unavailable MLX runtime resolves to an Ollama-backed model (no throw).
- [ ] **Step 2: Run to verify it fails.**
- [ ] **Step 3: Implement** in `select-hook.ts`: `let rt = runtimeFor(decl.runtime); if (!(await rt.isAvailable()) && decl.runtime !== RuntimeKind.Ollama) { log degrade; rt = runtimeFor(RuntimeKind.Ollama); }` then `rt.createModel(decl)`. Pass `numCtx` when `rt.kind === RuntimeKind.Ollama`.
- [ ] **Step 4: Run to verify it passes.**
- [ ] **Step 5: Commit**

```bash
git add src/cli/select-hook.ts tests/cli/select-hook.test.ts
git commit -m "feat(runtime): MLX opt-in selection degrades to Ollama when unreachable"
```

---

