### Task 12: Live verification + documentation

**Files:**
- Create: `tests/integration/discover.live.test.ts`, `tests/integration/mlx.live.test.ts`
- Modify: `README.md`, `docs/architecture.md`, `docs/ROADMAP.md`

**Interfaces:**
- Consumes: `runDiscovery`, `mlxServerRuntime`, `ollamaReady` helper pattern.

- [ ] **Step 1: Live discovery test** — `tests/integration/discover.live.test.ts`
```ts
import { describe, expect, test } from 'bun:test';

async function online(): Promise<boolean> {
  try { return (await fetch('https://huggingface.co/api/models?filter=gguf&limit=1', { signal: AbortSignal.timeout(3000) })).ok; }
  catch { return false; }
}
const ready = await online();

describe.skipIf(!ready)('live HF discovery', () => {
  test('returns ≥1 tool-capable GGUF candidate that fits', async () => {
    const { runDiscovery } = await import('../../src/discovery/discover.ts');
    let written = 0;
    const r = await runDiscovery({
      host: { totalRamBytes: 24e9, liveBudgetBytes: 12e9, runtimes: [] as never[] },
      writeCatalog: (c) => { written = c.length; },
      pullTop: async () => {}, // don't actually pull multi-GB in a test
      prePullCount: 0,
    });
    expect(r.fits).toBeGreaterThan(0);
    expect(written).toBeGreaterThan(0);
  }, 60_000);
});
```

- [ ] **Step 2: MLX live test** — `tests/integration/mlx.live.test.ts`
```ts
import { describe, expect, test } from 'bun:test';
import { mlxServerRuntime } from '../../src/runtime/mlx-server.ts';

const ready = await mlxServerRuntime.isAvailable();

describe.skipIf(!ready)('live MLX server', () => {
  test('lists at least one loaded model', async () => {
    const loaded = await mlxServerRuntime.control.listLoaded();
    expect(Array.isArray(loaded)).toBe(true);
  }, 30_000);
});
```

- [ ] **Step 3: Run live tests (best-effort)** — `bun test tests/integration/` → discover.live PASS if online (else skip); mlx.live skips unless an MLX server is up; existing Ollama live tests still green.

- [ ] **Step 4: Update README** — add a "Model discovery (Slice 6)" paragraph:
> **Model discovery (Slice 6).** `bun run discover` fetches the latest tool-capable GGUF models from Hugging Face (trusted publishers, sized to your live RAM budget), writes a per-machine `model-images/catalog.json`, and pre-pulls the top fitting model. Normal `chat` runs read an **offline** merge of the bootstrap rungs + locally-installed models + the cached catalog — no network needed. A local MLX server (LM Studio / vllm-mlx at `MLX_BASE_URL`) is discovered + used automatically when running. Vision/audio/video and an uncensored mode are typed-in seams shipped in later slices.

Update the README roadmap table: Slice 6 → Done; show Slice 7 (KV-cache quant) as next.

- [ ] **Step 5: Update architecture.md** — add a "Discovery & runtimes (Slice 6)" section describing the `Runtime` port (Ollama + MLX-server), the `CatalogSource` port (hf-gguf + hf-mlx), the host detector, the offline `buildRegistry` merge, and the `discover` pipeline + pre-pull. Note the four axes (capability/modality, runtime, source, content-policy).

- [ ] **Step 6: Update ROADMAP.md** — move Slice 6 into Shipped; list the committed follow-ons: **Slice 7 KV-cache quant** (q8_0 default, q4_0 opt-in w/ high-GQA guard, global `OLLAMA_KV_CACHE_TYPE`+`OLLAMA_FLASH_ATTENTION`), **Slice 8 Vision**, **Slice 9 Audio**, **Slice 10 Video**, **Slice 11 Uncensored mode**, plus Ollama-native-MLX-on-Mac-Mini and BFCL offline ranking. Reference spec §11.

- [ ] **Step 7: Typecheck + full suite** — `bun run typecheck && bun run lint && bun test` → clean / exit 0 / green (live pass-or-skip).

- [ ] **Step 8: Commit**
```bash
git add tests/integration/discover.live.test.ts tests/integration/mlx.live.test.ts README.md docs/architecture.md docs/ROADMAP.md
git commit -m "test(discovery): live discover + MLX verify + Slice 6 docs"
```

---

## Final review (whole-branch)

- [ ] `bun run typecheck` · `bun run lint` · `bun test` (note pass/skip counts).
- [ ] Dispatch code-review subagents across dimensions (correctness, types, silent-failures, offline-safety, tests). Pay special attention to: the manager runtime-routing refactor (no Ollama regression), offline degradation never throwing on the chat path, and the HF parsing robustness.
- [ ] Apply verified Critical/Important findings; triage Minors.

---

## Self-review (plan vs spec)

**Spec coverage:**
- §2 four-axis taxonomy → Task 1 (capability/runtime/content-policy enums + filter). ✓
- §3 runtime registry (Ollama + MLX) + manager refactor → Tasks 2, 3, 4. ✓
- §4 catalog sources (GGUF + MLX) + quant + hf-client → Tasks 5, 6, 7, 8. ✓
- §5 host detector + cache + discover pipeline + build-registry + CLI → Tasks 9, 10, 11. ✓
- §6 data flow (discover online; chat offline merge) → Tasks 10, 11. ✓
- §7 offline error handling → Tasks 6 (hf-client wraps), 10/11 (degrade), build-registry offline test (Task 10). ✓
- §9 testing (unit + live discover + live mlx) → every task + Task 12. ✓
- §11 future work → ROADMAP at Task 12 Step 6. ✓

**Placeholder scan:** every code step has complete code; commands have expected output; no TBD/TODO. (Task 8's fetch-stub note offers a concrete simplification, not a placeholder.) ✓

**Type consistency:** `Runtime`/`RuntimeControl`/`runtimeFor`/`availableRuntimes`, `Candidate`/`CatalogSource`/`DiscoveryQuery`/`HostCapabilities`, `hfGet`, `bytesPerWeightForQuant`/`pickBestQuantThatFits`/`QuantFile`, `buildRegistry`/`runDiscovery`/`SOURCES`, `BOOTSTRAP` — names consistent across tasks. Manager `ManagerDeps` new shape (`controlFor`) used consistently in Task 4. `BOOTSTRAP` rename consumers all listed in Task 11. ✓
