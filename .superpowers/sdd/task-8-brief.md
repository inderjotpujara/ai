### Task 8: Capture `lfs.oid` from the HF tree (verify-when-available)

**Files:**
- Modify: `src/provisioning/catalog/hf-catalog.ts:12,26` (`TreeEntry` + fetch), add an exported `hfTreeFiles(repo): Promise<{ path: string; size: number; oid?: string }[]>`
- Modify: `src/provisioning/providers/hf-fetch.ts` (accept `resolveOid?` dep or thread oid via the tree listing)
- Test: `tests/provisioning/hf-catalog.test.ts` (extend/new)

**Interfaces:**
- Produces: `hfTreeFiles(repo)` returns per-file `{ path, size, oid? }` where `oid` = `lfs.oid` when the entry is LFS-backed.

- [ ] **Step 1: Write the failing test** — a fake fetch returns a tree with an `lfs: { oid: 'abc', size: 5 }` entry; assert `hfTreeFiles` surfaces `oid: 'abc'`.
- [ ] **Step 2: Run to verify it fails.**
- [ ] **Step 3: Extend `TreeEntry`** to `{ path: string; size?: number; lfs?: { size?: number; oid?: string } }`; add `hfTreeFiles` mapping `oid = e.lfs?.oid`. Keep `hfTreeSize` working (sum `lfs?.size ?? size`).
- [ ] **Step 4: Run to verify it passes.**
- [ ] **Step 5: Commit**

```bash
git add src/provisioning/catalog/hf-catalog.ts tests/provisioning/hf-catalog.test.ts
git commit -m "feat(provisioning): capture HF LFS oid (sha256) for download verification"
```

---

