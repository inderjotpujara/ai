### Task 3: Hardware-fit + downloadable `CatalogSource`s (Ollama manifest + HF tree) + snapshot fallback

**Files:**
- Create: `src/provisioning/catalog/snapshot.json` (committed floor catalog; top-N per backend with pre-resolved sizes)
- Create: `src/provisioning/catalog/snapshot-source.ts` (reads the committed JSON)
- Create: `src/provisioning/catalog/ollama-catalog.ts` (community-JSON list + registry-manifest size)
- Create: `src/provisioning/catalog/hf-catalog.ts` (HF search list + tree size; covers llama.cpp + MLX)
- Create: `src/provisioning/fit.ts` (fit-filter + rank + recommended flag)
- Test: `tests/provisioning/fit.test.ts`
- Test: `tests/provisioning/ollama-catalog.test.ts`
- Test: `tests/provisioning/hf-catalog.test.ts`
- Test: `tests/provisioning/snapshot-source.test.ts`

**Interfaces:**
- Consumes: `Candidate`, `CatalogSource`, `DiscoveryQuery`, `HostCapabilities` (discovery); `estimateModelBytes` (footprint); `fitsBudget` (hardware); `ProviderKind`.
- Produces:
  - `type FitCandidate = Candidate & { estimatedBytes: number; fits: boolean; recommended: boolean }`
  - `fitAndRank(candidates: Candidate[], budgetBytes: number): FitCandidate[]` (filter fits, rank largest-that-fits, mark top-per-runtime recommended)
  - `ollamaManifestSize(model: string, tag: string, fetchImpl?): Promise<number>` (sum `layers[].size`)
  - `createOllamaCatalogSource(deps?): CatalogSource`
  - `hfTreeSize(repoId: string, opts, fetchImpl?): Promise<number>`; `createHfCatalogSource(kind: ProviderKind, deps?): CatalogSource`
  - `createSnapshotSource(): CatalogSource` (+ `loadSnapshot(): Candidate[]`)
  - `withSnapshotFallback(source: CatalogSource, fallback: CatalogSource): CatalogSource` (per-source degrade)

- [ ] **Step 1: Write failing tests for `fitAndRank`.**

```ts
// tests/provisioning/fit.test.ts
import { describe, expect, it } from 'bun:test';
import { fitAndRank } from '../../src/provisioning/fit.ts';
import { ProviderKind } from '../../src/core/types.ts';

const cand = (model: string, params: number, size: number) => ({
  provider: ProviderKind.Ollama, model, params: {}, role: 'x',
  footprint: { approxParamsBillions: params, bytesPerWeight: 0.6 },
  repo: model, fileSizeBytes: size, downloads: 100, installed: false,
});

describe('fitAndRank', () => {
  it('drops candidates that do not fit the budget', () => {
    const out = fitAndRank([cand('big', 70, 40e9), cand('small', 4, 3e9)], 8e9);
    expect(out.every((c) => c.fits)).toBe(true);
    expect(out.map((c) => c.model)).toEqual(['small']);
  });
  it('ranks larger-that-fits first', () => {
    const out = fitAndRank([cand('a', 4, 3e9), cand('b', 7, 5e9)], 8e9);
    expect(out.map((c) => c.model)).toEqual(['b', 'a']);
  });
  it('marks the top fitting model per runtime as recommended', () => {
    const out = fitAndRank([cand('a', 4, 3e9), cand('b', 7, 5e9)], 8e9);
    expect(out.find((c) => c.model === 'b')?.recommended).toBe(true);
    expect(out.find((c) => c.model === 'a')?.recommended).toBe(false);
  });
});
```

- [ ] **Step 2: Run, verify fail; then create `src/provisioning/fit.ts`.**

```ts
import type { Candidate } from '../discovery/catalog-source.ts';
import { ProviderKind } from '../core/types.ts';
import { estimateModelBytes } from '../resource/footprint.ts';
import { fitsBudget } from '../resource/hardware.ts';

export type FitCandidate = Candidate & { estimatedBytes: number; fits: boolean; recommended: boolean };

const DEFAULT_KV_PER_TOKEN = 131072;
const FIT_CONTEXT_TOKENS = 8192; // sizing context for the fit estimate

/** Filter to models that fit, rank largest-that-fits, mark top-per-runtime recommended. */
export function fitAndRank(candidates: Candidate[], budgetBytes: number): FitCandidate[] {
  const scored = candidates.map((c) => {
    const estimatedBytes = Math.max(
      c.fileSizeBytes,
      estimateModelBytes({
        paramsBillions: c.footprint.approxParamsBillions,
        bytesPerWeight: c.footprint.bytesPerWeight,
        contextTokens: FIT_CONTEXT_TOKENS,
        kvBytesPerToken: c.footprint.kvBytesPerToken ?? DEFAULT_KV_PER_TOKEN,
      }),
    );
    return { ...c, estimatedBytes, fits: fitsBudget(estimatedBytes, budgetBytes), recommended: false };
  });
  const fitting = scored
    .filter((c) => c.fits)
    .sort((a, b) => b.footprint.approxParamsBillions - a.footprint.approxParamsBillions);
  const seen = new Set<ProviderKind>();
  for (const c of fitting) {
    if (!seen.has(c.provider)) {
      c.recommended = true;
      seen.add(c.provider);
    }
  }
  return fitting;
}
```

- [ ] **Step 3: Run, verify pass.**

Run: `bun test tests/provisioning/fit.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 4: Write failing test for `ollamaManifestSize` (inject a fake fetch returning a manifest).**

```ts
// tests/provisioning/ollama-catalog.test.ts
import { describe, expect, it } from 'bun:test';
import { ollamaManifestSize } from '../../src/provisioning/catalog/ollama-catalog.ts';

describe('ollamaManifestSize', () => {
  it('sums layer sizes plus config size from the registry manifest', async () => {
    const fakeFetch = async () => new Response(JSON.stringify({
      config: { size: 561 },
      layers: [{ size: 2_000_000_000 }, { size: 8_000 }, { size: 4_000 }],
    }), { status: 200 });
    const bytes = await ollamaManifestSize('llama3.2', 'latest', fakeFetch as unknown as typeof fetch);
    expect(bytes).toBe(2_000_000_000 + 8_000 + 4_000 + 561);
  });
  it('throws on a non-200 manifest response', async () => {
    const fakeFetch = async () => new Response('nope', { status: 404 });
    await expect(ollamaManifestSize('x', 'latest', fakeFetch as unknown as typeof fetch)).rejects.toThrow();
  });
});
```

- [ ] **Step 5: Run, verify fail; then create `src/provisioning/catalog/ollama-catalog.ts`.**

```ts
import { ProviderError } from '../../core/errors.ts';
import { ProviderKind } from '../../core/types.ts';
import type { Candidate, CatalogSource, DiscoveryQuery, HostCapabilities } from '../../discovery/catalog-source.ts';

const REGISTRY = 'https://registry.ollama.ai/v2/library';

type Manifest = { config?: { size?: number }; layers?: Array<{ size?: number }> };

/** Authoritative pre-pull size: sum layers[].size (+ config.size) from the registry manifest. */
export async function ollamaManifestSize(
  model: string,
  tag: string,
  fetchImpl: typeof fetch = fetch,
): Promise<number> {
  let res: Response;
  try {
    res = await fetchImpl(`${REGISTRY}/${model}/manifests/${tag}`);
  } catch (cause) {
    throw new ProviderError('Ollama registry manifest fetch failed', { cause });
  }
  if (!res.ok) throw new ProviderError(`Ollama registry manifest returned ${res.status}`);
  const m = (await res.json()) as Manifest;
  const layers = (m.layers ?? []).reduce((sum, l) => sum + (l.size ?? 0), 0);
  return layers + (m.config?.size ?? 0);
}

// Community catalog JSON (list only; sizes enriched lazily via the manifest above).
const CATALOG_JSON =
  'https://raw.githubusercontent.com/chrizzo84/OllamaScraper/refs/heads/main/out/ollama_models.json';

type CatalogEntry = { name?: string; tag?: string; size_bytes?: number; pulls?: number };

export function createOllamaCatalogSource(
  deps: { fetchImpl?: typeof fetch } = {},
): CatalogSource {
  const fetchImpl = deps.fetchImpl ?? fetch;
  return {
    name: 'ollama-catalog',
    appliesTo: (host: HostCapabilities) => host.runtimes.includes(ProviderKind.Ollama),
    async listCandidates(_q: DiscoveryQuery): Promise<Candidate[]> {
      const res = await fetchImpl(CATALOG_JSON);
      if (!res.ok) throw new ProviderError(`Ollama catalog JSON returned ${res.status}`);
      const entries = (await res.json()) as CatalogEntry[];
      return entries
        .filter((e) => e.name)
        .map((e) => ({
          provider: ProviderKind.Ollama,
          model: e.tag ? `${e.name}:${e.tag}` : (e.name as string),
          params: {},
          role: 'discovered',
          footprint: { approxParamsBillions: 0, bytesPerWeight: 0.6 },
          repo: e.name as string,
          quant: e.tag,
          fileSizeBytes: e.size_bytes ?? 0, // lazy: 0 until enriched
          downloads: e.pulls ?? 0,
          installed: false,
        }));
    },
  };
}
```

Note: `approxParamsBillions: 0` is a placeholder for entries whose param count the catalog JSON doesn't carry — enrichment (Task 4 wiring) fills `fileSizeBytes` from `ollamaManifestSize`; the committed snapshot (below) carries real param counts for the recommended bootstrap set so `fitAndRank` has accurate data for the models we actually recommend.

- [ ] **Step 6: Run, verify pass.**

Run: `bun test tests/provisioning/ollama-catalog.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 7: Write failing test for `hfTreeSize` (inject fake fetch returning a tree).**

```ts
// tests/provisioning/hf-catalog.test.ts
import { describe, expect, it } from 'bun:test';
import { hfTreeSize } from '../../src/provisioning/catalog/hf-catalog.ts';

describe('hfTreeSize', () => {
  it('returns the size of a single matching GGUF file', async () => {
    const fakeFetch = async () => new Response(JSON.stringify([
      { path: 'model-Q4_K_M.gguf', size: 4_100_000_000 },
      { path: 'README.md', size: 1_000 },
    ]), { status: 200 });
    const bytes = await hfTreeSize('bartowski/x-GGUF', { file: 'model-Q4_K_M.gguf' }, fakeFetch as unknown as typeof fetch);
    expect(bytes).toBe(4_100_000_000);
  });
  it('sums the whole tree for an MLX snapshot (no file filter)', async () => {
    const fakeFetch = async () => new Response(JSON.stringify([
      { path: 'a.safetensors', size: 2_000_000_000 },
      { path: 'b.safetensors', size: 1_000_000_000 },
      { path: 'config.json', size: 500 },
    ]), { status: 200 });
    const bytes = await hfTreeSize('mlx-community/x', {}, fakeFetch as unknown as typeof fetch);
    expect(bytes).toBe(3_000_000_500);
  });
});
```

- [ ] **Step 8: Run, verify fail; then create `src/provisioning/catalog/hf-catalog.ts`.**

```ts
import { ProviderError } from '../../core/errors.ts';
import { ProviderKind } from '../../core/types.ts';
import type { Candidate, CatalogSource, DiscoveryQuery, HostCapabilities } from '../../discovery/catalog-source.ts';

const HF_API = 'https://huggingface.co/api';

type TreeEntry = { path: string; size?: number };

function hfHeaders(): Record<string, string> {
  const token = process.env.HF_TOKEN; // env-fallback only; degrade to anonymous
  return token ? { authorization: `Bearer ${token}` } : {};
}

/** Pre-download size: one GGUF file's size, or the summed tree for a snapshot. */
export async function hfTreeSize(
  repoId: string,
  opts: { file?: string },
  fetchImpl: typeof fetch = fetch,
): Promise<number> {
  const res = await fetchImpl(`${HF_API}/models/${repoId}/tree/main?recursive=true`, { headers: hfHeaders() });
  if (!res.ok) throw new ProviderError(`HF tree returned ${res.status}`);
  const tree = (await res.json()) as TreeEntry[];
  if (opts.file) {
    const hit = tree.find((e) => e.path === opts.file);
    if (!hit) throw new ProviderError(`HF file ${opts.file} not found in ${repoId}`);
    return hit.size ?? 0;
  }
  return tree.reduce((sum, e) => sum + (e.size ?? 0), 0);
}

type SearchEntry = { id: string; downloads?: number };

/** kind = which runtime consumes these (Ollama-independent): MlxServer for MLX; filter differs. */
export function createHfCatalogSource(
  kind: ProviderKind,
  deps: { filter?: string; fetchImpl?: typeof fetch } = {},
): CatalogSource {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const filter = deps.filter ?? (kind === ProviderKind.MlxServer ? 'mlx' : 'gguf');
  return {
    name: `hf-catalog-${filter}`,
    appliesTo: (_host: HostCapabilities) => true, // HF reachable regardless of local runtime
    async listCandidates(_q: DiscoveryQuery): Promise<Candidate[]> {
      const url = `${HF_API}/models?filter=${filter}&sort=downloads&direction=-1&limit=30`;
      const res = await fetchImpl(url, { headers: hfHeaders() });
      if (!res.ok) throw new ProviderError(`HF search returned ${res.status}`);
      const entries = (await res.json()) as SearchEntry[];
      return entries.map((e) => ({
        provider: kind,
        model: e.id,
        params: {},
        role: 'discovered',
        footprint: { approxParamsBillions: 0, bytesPerWeight: 0.6 },
        repo: e.id,
        fileSizeBytes: 0, // lazy: enriched via hfTreeSize
        downloads: e.downloads ?? 0,
        installed: false,
      }));
    },
  };
}
```

- [ ] **Step 9: Run, verify pass.**

Run: `bun test tests/provisioning/hf-catalog.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 10: Create the committed snapshot + source, with a failing test first.**

```ts
// tests/provisioning/snapshot-source.test.ts
import { describe, expect, it } from 'bun:test';
import { loadSnapshot, withSnapshotFallback } from '../../src/provisioning/catalog/snapshot-source.ts';
import { ProviderKind } from '../../src/core/types.ts';
import type { CatalogSource } from '../../src/discovery/catalog-source.ts';

describe('snapshot', () => {
  it('loads a non-empty committed snapshot with real sizes', () => {
    const snap = loadSnapshot();
    expect(snap.length).toBeGreaterThan(0);
    expect(snap.every((c) => c.fileSizeBytes > 0)).toBe(true);
  });
});

describe('withSnapshotFallback', () => {
  const host = { totalRamBytes: 24e9, liveBudgetBytes: 8e9, runtimes: [ProviderKind.Ollama] };
  const query = { budgetBytes: 8e9, hostTotalRamBytes: 24e9 };
  it('falls back to the snapshot slice when the live source throws', async () => {
    const failing: CatalogSource = { name: 'live', appliesTo: () => true, listCandidates: async () => { throw new Error('429'); } };
    const snap: CatalogSource = { name: 'snap', appliesTo: () => true, listCandidates: async () => [
      { provider: ProviderKind.Ollama, model: 'qwen3.5:4b', params: {}, role: 'x',
        footprint: { approxParamsBillions: 4, bytesPerWeight: 0.6 }, repo: 'qwen3.5', fileSizeBytes: 3e9, downloads: 1, installed: false },
    ] };
    const merged = withSnapshotFallback(failing, snap);
    const out = await merged.listCandidates(query);
    expect(out.map((c) => c.model)).toEqual(['qwen3.5:4b']);
  });
});
```

- [ ] **Step 11: Run, verify fail; then create the snapshot JSON + source.**

`src/provisioning/catalog/snapshot.json` (the committed floor — real bootstrap models with accurate params + Q4 sizes; extend as models are added):

```json
[
  { "provider": "Ollama", "model": "qwen3.5:4b", "repo": "qwen3.5", "quant": "Q4_K_M",
    "params_billions": 4, "bytes_per_weight": 0.6, "file_size_bytes": 3000000000, "downloads": 100000,
    "role": "routing / orchestration", "capabilities": ["tools"] },
  { "provider": "Ollama", "model": "qwen3.5:9b", "repo": "qwen3.5", "quant": "Q4_K_M",
    "params_billions": 9, "bytes_per_weight": 0.6, "file_size_bytes": 6600000000, "downloads": 100000,
    "role": "general reasoning + tool use", "capabilities": ["tools"] },
  { "provider": "Ollama", "model": "qwen3-embedding:0.6b", "repo": "qwen3-embedding", "quant": "Q4_K_M",
    "params_billions": 0.6, "bytes_per_weight": 0.6, "file_size_bytes": 640000000, "downloads": 50000,
    "role": "embeddings", "capabilities": [] },
  { "provider": "Ollama", "model": "bespoke-minicheck", "repo": "bespoke-minicheck", "quant": "Q4_K_M",
    "params_billions": 7, "bytes_per_weight": 0.6, "file_size_bytes": 4700000000, "downloads": 20000,
    "role": "faithfulness judge", "capabilities": [] }
]
```

`src/provisioning/catalog/snapshot-source.ts`:

```ts
import { Capability, type ContentPolicy, ProviderKind } from '../../core/types.ts';
import type { Candidate, CatalogSource, DiscoveryQuery } from '../../discovery/catalog-source.ts';
import snapshot from './snapshot.json' with { type: 'json' };

type SnapshotEntry = {
  provider: string; model: string; repo: string; quant?: string;
  params_billions: number; bytes_per_weight: number; file_size_bytes: number;
  downloads: number; role: string; capabilities?: string[];
};

/** Read the committed snapshot catalog into Candidates. The robustness floor. */
export function loadSnapshot(): Candidate[] {
  return (snapshot as SnapshotEntry[]).map((e) => ({
    provider: e.provider as ProviderKind,
    model: e.model,
    params: {},
    role: e.role,
    capabilities: (e.capabilities ?? []) as Capability[],
    footprint: { approxParamsBillions: e.params_billions, bytesPerWeight: e.bytes_per_weight },
    repo: e.repo,
    quant: e.quant,
    fileSizeBytes: e.file_size_bytes,
    downloads: e.downloads,
    installed: false,
  }));
}

export function createSnapshotSource(): CatalogSource {
  return {
    name: 'snapshot',
    appliesTo: () => true,
    listCandidates: async (_q: DiscoveryQuery) => loadSnapshot(),
  };
}

/** Try the live source; on ANY error, degrade to the fallback's slice. Never throws for source failure. */
export function withSnapshotFallback(source: CatalogSource, fallback: CatalogSource): CatalogSource {
  return {
    name: `${source.name}+snapshot`,
    appliesTo: source.appliesTo,
    async listCandidates(q: DiscoveryQuery): Promise<Candidate[]> {
      try {
        const live = await source.listCandidates(q);
        return live.length > 0 ? live : fallback.listCandidates(q);
      } catch {
        return fallback.listCandidates(q);
      }
    },
  };
}
```

- [ ] **Step 12: Run all Task-3 tests, typecheck, lint.**

Run: `bun test tests/provisioning/ && bun run typecheck && bun run lint:file -- "src/provisioning/**/*.ts"`
Expected: all PASS; clean.

- [ ] **Step 13: Commit.**

```bash
git add src/provisioning/fit.ts src/provisioning/catalog tests/provisioning/fit.test.ts tests/provisioning/ollama-catalog.test.ts tests/provisioning/hf-catalog.test.ts tests/provisioning/snapshot-source.test.ts
git commit -m "feat(provisioning): hardware-fit + downloadable catalog sources + snapshot fallback (Slice 14 Task 3)"
```

---

