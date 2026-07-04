### Task 7: hf-fetch — sha256 mismatch fails + cleans up

**Files:** Modify: `src/provisioning/providers/hf-fetch.ts` (behavior already added in Task 6); Test: `tests/provisioning/hf-fetch.test.ts`.

- [ ] **Step 1: Write the failing test** — inject `sha256: async () => 'wronghash'` + an `expectedOid` and assert `download` rejects and no `.part`/final file remains.

```ts
it('fails and cleans up when sha256 mismatches the expected oid', async () => {
  const dest = mkdtempSync(join(tmpdir(), 'hf-'));
  const provider = createHfFetchProvider(ProviderKind.HfGguf, {
    fetchImpl: (async () => streamingResponse([new Uint8Array(10)], 10)) as unknown as typeof fetch,
    sha256: async () => 'wronghash',
    resolveOid: async () => 'expectedhash', // see Task 8 for the dep name
  });
  await expect(provider.download('org/repo::m.gguf', {
    onProgress: () => {}, signal: new AbortController().signal, destDir: dest,
  })).rejects.toThrow();
  expect(existsSync(join(dest, 'm.gguf'))).toBe(false);
  expect(existsSync(join(dest, 'm.gguf.part'))).toBe(false);
});
```

- [ ] **Step 2: Run to verify it fails** (if `resolveOid` not yet wired) — coordinate with Task 8; if Task 8 lands first, this passes after the mismatch branch exists.
- [ ] **Step 3: Ensure the mismatch branch throws + `finally` unlinks** (implemented in Task 6 step 3.3/3.5).
- [ ] **Step 4: Run to verify it passes** — PASS.
- [ ] **Step 5: Commit**

```bash
git add src/provisioning/providers/hf-fetch.ts tests/provisioning/hf-fetch.test.ts
git commit -m "test(provisioning): hf-fetch fails+cleans up on sha256 mismatch"
```

---

