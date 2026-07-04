### Task 5: Add `destDir` to the download contract + supply it from the provisioner

**Files:**
- Modify: `src/provisioning/types.ts:27-30` (`download` opts)
- Modify: `src/provisioning/provisioner.ts:117` (pass `destDir`)
- Modify: `src/provisioning/providers/{ollama,lmstudio}.ts` (accept + ignore `destDir` — daemon owns disk)
- Test: `tests/provisioning/provisioner.test.ts` (extend or new assertion)

**Interfaces:**
- Produces: `download(modelRef, { onProgress, signal, destDir }): Promise<void>` where `destDir: string`.

- [ ] **Step 1: Write the failing test** — assert the provisioner passes a non-empty `destDir` to the provider.

```ts
import { describe, expect, it } from 'bun:test';
import { runProvision } from '../../src/provisioning/provisioner.ts';
// build minimal deps with a fake providerFor capturing opts; assert opts.destDir is a string dir.
it('passes a destDir to the download provider', async () => {
  let seen: string | undefined;
  const fakeProvider = { kind: 'HfSnapshot' as any, async download(_ref: string, o: any) { seen = o.destDir; } };
  // ...invoke runProvision with deps.providerFor = () => fakeProvider and one selected candidate...
  expect(typeof seen).toBe('string');
  expect(seen!.length).toBeGreaterThan(0);
});
```
(Use the existing provisioner test harness/fixtures as the scaffold; mirror its `deps` shape.)

- [ ] **Step 2: Run to verify it fails**

Run: `bun run test:file -- "tests/provisioning/provisioner.test.ts"`
Expected: FAIL — `destDir` is `undefined`.

- [ ] **Step 3: Edit `src/provisioning/types.ts`**

```ts
download(
  modelRef: string,
  opts: { onProgress: (p: DownloadProgress) => void; signal: AbortSignal; destDir: string },
): Promise<void>;
```

- [ ] **Step 4: Edit `src/provisioning/provisioner.ts:117`**

Compute the dir once (env fallback only): `const destDir = process.env.HF_HOME ?? process.env.OLLAMA_MODELS ?? \`${process.cwd()}/model-images\`;` and pass `destDir` in the `download(...)` opts. Ollama/LM Studio providers accept the new opt and ignore it (their daemon owns disk).

- [ ] **Step 5: Run to verify it passes** — `bun run test:file -- "tests/provisioning/provisioner.test.ts"` → PASS.

- [ ] **Step 6: Commit**

```bash
git add src/provisioning/types.ts src/provisioning/provisioner.ts src/provisioning/providers/ollama.ts src/provisioning/providers/lmstudio.ts tests/provisioning/provisioner.test.ts
git commit -m "feat(provisioning): add destDir to the download contract"
```

---

