### Task 6: hf-fetch — single-file atomic write + sha256 (HfGguf)

**Files:**
- Modify: `src/provisioning/providers/hf-fetch.ts`
- Test: `tests/provisioning/hf-fetch.test.ts` (extend)

**Interfaces:**
- Consumes: `destDir` opt (Task 5), existing `sha256File(path)` helper, `ProgressTracker`, `DownloadPhase`.
- Produces: on `HfGguf` download, a file at `<destDir>/<file>` (atomic via `.part`→rename); phases include `Verifying` + `Finalizing`; no `.part` left on success or failure.

- [ ] **Step 1: Write the failing test** — download writes bytes to disk, no `.part` remains.

```ts
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
// reuse streamingResponse() from the existing test file
it('HfGguf: writes the file to destDir atomically and reaches Done', async () => {
  const dest = mkdtempSync(join(tmpdir(), 'hf-'));
  const chunk = new Uint8Array(1000);
  const provider = createHfFetchProvider(ProviderKind.HfGguf, {
    fetchImpl: (async () => streamingResponse([chunk, chunk], 2000)) as unknown as typeof fetch,
  });
  const phases: DownloadPhase[] = [];
  await provider.download('org/repo::model.gguf', {
    onProgress: (p) => phases.push(p.phase), signal: new AbortController().signal, destDir: dest,
  });
  const out = join(dest, 'model.gguf');
  expect(existsSync(out)).toBe(true);
  expect(readFileSync(out).byteLength).toBe(2000);
  expect(existsSync(out + '.part')).toBe(false);
  expect(phases).toContain(DownloadPhase.Finalizing);
  expect(phases.at(-1)).toBe(DownloadPhase.Done);
});
```

- [ ] **Step 2: Run to verify it fails** — `bun run test:file -- "tests/provisioning/hf-fetch.test.ts"` → FAIL (no file written; no `Finalizing`).

- [ ] **Step 3: Implement in `hf-fetch.ts`** — add a private `downloadFile(url, destPath, {onProgress, signal, tracker, expectedOid})` that:
  1. opens a write stream to `destPath + '.part'`;
  2. in the read loop writes each `value` chunk (`await write(value)`), accumulates `done`, emits `Downloading`;
  3. on loop end: emit `Verifying`; `const hash = await (deps.sha256 ?? sha256File)(destPath + '.part')`; if `expectedOid` present and `hash !== expectedOid` → throw `ProviderError` (finally unlinks `.part`);
  4. emit `Finalizing`; `await rename(destPath + '.part', destPath)`;
  5. wrap steps 1-4 in `try { ... } finally { if still exists, unlink .part }` so aborts/errors clean up.

  For `HfGguf` (`file` present), `destPath = join(destDir, file)`.

- [ ] **Step 4: Run to verify it passes** — PASS.

- [ ] **Step 5: Commit**

```bash
git add src/provisioning/providers/hf-fetch.ts tests/provisioning/hf-fetch.test.ts
git commit -m "feat(provisioning): hf-fetch writes single GGUF files atomically with sha256"
```

---

