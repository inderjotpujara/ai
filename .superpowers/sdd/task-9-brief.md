### Task 9: hf-fetch — multi-file snapshot enumeration (HfSnapshot)

**Files:** Modify: `src/provisioning/providers/hf-fetch.ts`; Test: `tests/provisioning/hf-fetch.test.ts`.

**Interfaces:**
- Consumes: `hfTreeFiles(repo)` (Task 8), `downloadFile` (Task 6).
- Produces: on `HfSnapshot` (bare `repo`, no `::file`), downloads every tree file to `<destDir>/<repo>/<path>`, each atomic + oid-verified when available.

- [ ] **Step 1: Write the failing test** — fake `treeFiles` dep returns two files; fake fetch returns per-file bytes; assert both files exist under `<dest>/<repo>/…`, phases reach `Done`.

```ts
it('HfSnapshot: enumerates the repo tree and writes every file', async () => {
  const dest = mkdtempSync(join(tmpdir(), 'hf-'));
  const provider = createHfFetchProvider(ProviderKind.HfSnapshot, {
    treeFiles: async () => [ { path: 'config.json', size: 3 }, { path: 'model.safetensors', size: 5 } ],
    fetchImpl: (async (u: string) => streamingResponse([new Uint8Array(u.endsWith('config.json') ? 3 : 5)], u.endsWith('config.json') ? 3 : 5)) as unknown as typeof fetch,
  });
  await provider.download('mlx-community/x', { onProgress: () => {}, signal: new AbortController().signal, destDir: dest });
  expect(existsSync(join(dest, 'mlx-community/x/config.json'))).toBe(true);
  expect(existsSync(join(dest, 'mlx-community/x/model.safetensors'))).toBe(true);
});
```

- [ ] **Step 2: Run to verify it fails.**
- [ ] **Step 3: Implement the snapshot branch** — when `file` is absent: `const files = await (deps.treeFiles ?? hfTreeFiles)(repo);` then for each file `await downloadFile(\`${HF_RESOLVE}/${repo}/resolve/main/${f.path}\`, join(destDir, repo, f.path), { ..., expectedOid: f.oid })`, creating parent dirs (`mkdir(dirname, { recursive: true })`). Aggregate progress across files (sum sizes for `bytesTotal`).
- [ ] **Step 4: Run to verify it passes.**
- [ ] **Step 5: Commit**

```bash
git add src/provisioning/providers/hf-fetch.ts tests/provisioning/hf-fetch.test.ts
git commit -m "feat(provisioning): hf-fetch downloads whole MLX snapshots (multi-file) to disk"
```

---

