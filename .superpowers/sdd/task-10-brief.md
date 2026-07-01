### Task 10: Discovery pipeline + offline registry builder

**Files:**
- Create: `src/discovery/discover.ts`
- Create: `src/discovery/build-registry.ts`
- Create: `src/discovery/sources.ts` (the source registry)
- Test: `tests/discovery/build-registry.test.ts`, `tests/discovery/discover.test.ts`

**Interfaces:**
- Consumes: sources (Tasks 7–8), `detectHost`, cache (Task 9), `runtimeFor`/`availableRuntimes`, `BOOTSTRAP` (Task 11 renames `REGISTRY`; until then import `REGISTRY`), `Candidate`/`ModelDeclaration`.
- Produces: `SOURCES: CatalogSource[]`; `runDiscovery(deps?): Promise<{found,fits,pulled,path}>`; `buildRegistry(deps?): Promise<ModelDeclaration[]>`.

- [ ] **Step 1: Write the failing tests**

`tests/discovery/build-registry.test.ts`:
```ts
import { expect, test } from 'bun:test';
import { ProviderKind } from '../../src/core/types.ts';
import { buildRegistry } from '../../src/discovery/build-registry.ts';

const bootstrap = [{
  provider: ProviderKind.Ollama, model: 'qwen3.5:4b', params: {}, role: 'r',
  footprint: { approxParamsBillions: 4, bytesPerWeight: 0.56 },
}];

test('merges bootstrap + installed + catalog, deduped by (provider,model)', async () => {
  const reg = await buildRegistry({
    bootstrap,
    installed: async () => [{ provider: ProviderKind.Ollama, model: 'qwen3.5:9b', params: {}, role: 'i',
      footprint: { approxParamsBillions: 9, bytesPerWeight: 0.56 } }],
    readCatalog: () => [{ provider: ProviderKind.Ollama, model: 'qwen3.5:4b', params: {}, role: 'c',
      footprint: { approxParamsBillions: 4, bytesPerWeight: 0.56 },
      repo: 'x', fileSizeBytes: 1, downloads: 1, installed: true }],
  });
  expect(reg.map((d) => d.model).sort()).toEqual(['qwen3.5:4b', 'qwen3.5:9b']); // 4b deduped
});

test('offline: installed throws and catalog missing → still returns bootstrap (no throw)', async () => {
  const reg = await buildRegistry({
    bootstrap,
    installed: async () => { throw new Error('offline'); },
    readCatalog: () => undefined,
  });
  expect(reg.map((d) => d.model)).toEqual(['qwen3.5:4b']);
});
```
`tests/discovery/discover.test.ts`:
```ts
import { expect, test } from 'bun:test';
import { Capability, ProviderKind } from '../../src/core/types.ts';
import { runDiscovery } from '../../src/discovery/discover.ts';

test('fetches from applicable sources, filters/ranks, writes, pre-pulls top-1', async () => {
  const c = (model: string, dl: number, params: number) => ({
    provider: ProviderKind.Ollama, model, params: {}, role: 'r', capabilities: [Capability.Tools],
    footprint: { approxParamsBillions: params, bytesPerWeight: 0.56 },
    repo: model, quant: 'Q4_K_M', fileSizeBytes: params * 0.56e9 * 1.2, downloads: dl, installed: false,
  });
  const pulled: string[] = [];
  const out = await runDiscovery({
    host: { totalRamBytes: 24e9, liveBudgetBytes: 12e9, runtimes: [ProviderKind.Ollama] },
    sources: [{ name: 's', appliesTo: () => true, listCandidates: async () => [c('hf.co/a:Q4_K_M', 10, 7), c('hf.co/b:Q4_K_M', 99, 9)] }],
    writeCatalog: () => {},
    pullTop: async (m) => { pulled.push(m); },
    catalogPathStr: '/tmp/catalog.json',
  });
  expect(out.found).toBe(2);
  expect(pulled).toEqual(['hf.co/b:Q4_K_M']); // highest downloads, pre-pulled
});
```

- [ ] **Step 2: Run to verify fail** — `bun test tests/discovery/build-registry.test.ts tests/discovery/discover.test.ts` → FAIL.

- [ ] **Step 3: Implement**

`src/discovery/sources.ts`:
```ts
import type { CatalogSource } from './catalog-source.ts';
import { hfGgufSource } from './huggingface-gguf.ts';
import { hfMlxSource } from './huggingface-mlx.ts';

export const SOURCES: CatalogSource[] = [hfGgufSource, hfMlxSource];
```
`src/discovery/build-registry.ts`:
```ts
import type { ModelDeclaration } from '../core/types.ts';
import { REGISTRY } from '../../models/registry.ts'; // becomes BOOTSTRAP in Task 11
import { availableRuntimes } from '../runtime/registry.ts';
import { readCatalog } from './catalog-cache.ts';
import type { Candidate } from './catalog-source.ts';

export type BuildRegistryDeps = {
  bootstrap?: ModelDeclaration[];
  installed?: () => Promise<ModelDeclaration[]>;
  readCatalog?: () => Candidate[] | undefined;
};

async function installedFromRuntimes(): Promise<ModelDeclaration[]> {
  const out: ModelDeclaration[] = [];
  for (const rt of await availableRuntimes()) {
    try {
      for (const m of await rt.control.listLoaded()) {
        out.push({ provider: rt.kind, model: m.name, params: {}, role: 'installed',
          footprint: { approxParamsBillions: 0, bytesPerWeight: 0 } });
      }
    } catch { /* runtime down → contributes nothing */ }
  }
  return out;
}

/** OFFLINE-SAFE merge: bootstrap ∪ installed ∪ cached catalog, deduped by (provider,model). */
export async function buildRegistry(deps: BuildRegistryDeps = {}): Promise<ModelDeclaration[]> {
  const bootstrap = deps.bootstrap ?? REGISTRY;
  let installed: ModelDeclaration[] = [];
  try { installed = await (deps.installed ?? installedFromRuntimes)(); } catch { installed = []; }
  const catalog = (deps.readCatalog ?? (() => readCatalog()))() ?? [];

  const byKey = new Map<string, ModelDeclaration>();
  for (const d of [...bootstrap, ...installed, ...catalog]) {
    const key = `${d.provider}::${d.model}`;
    if (!byKey.has(key)) byKey.set(key, d); // first wins: bootstrap > installed > catalog
  }
  return [...byKey.values()];
}
```
`src/discovery/discover.ts`:
```ts
import type { Capability } from '../core/types.ts';
import { runtimeFor } from '../runtime/registry.ts';
import { catalogPath, writeCatalog as writeCatalogFile } from './catalog-cache.ts';
import type { Candidate, CatalogSource, HostCapabilities } from './catalog-source.ts';
import { detectHost } from './host.ts';
import { SOURCES } from './sources.ts';
import { Capability as Cap } from '../core/types.ts';

export type DiscoverDeps = {
  host?: HostCapabilities;
  sources?: CatalogSource[];
  writeCatalog?: (c: Candidate[]) => void;
  pullTop?: (model: string, provider: Candidate['provider']) => Promise<void>;
  catalogPathStr?: string;
  prePullCount?: number;
};

export type DiscoverResult = { found: number; fits: number; pulled: string[]; path: string };

export async function runDiscovery(deps: DiscoverDeps = {}): Promise<DiscoverResult> {
  const host = deps.host ?? (await detectHost());
  const sources = (deps.sources ?? SOURCES).filter((s) => s.appliesTo(host));
  const requires: Capability[] = [Cap.Tools];

  const all: Candidate[] = [];
  for (const s of sources) {
    try { all.push(...await s.listCandidates({ budgetBytes: host.liveBudgetBytes, requires, hostTotalRamBytes: host.totalRamBytes })); }
    catch { /* degrade: skip a failing source */ }
  }
  // dedupe by (provider, base repo), keep highest downloads
  const byRepo = new Map<string, Candidate>();
  for (const c of all) {
    const key = `${c.provider}::${c.repo}`;
    const prev = byRepo.get(key);
    if (!prev || c.downloads > prev.downloads) byRepo.set(key, c);
  }
  const ranked = [...byRepo.values()].sort(
    (a, b) => b.downloads - a.downloads || b.footprint.approxParamsBillions - a.footprint.approxParamsBillions,
  );

  (deps.writeCatalog ?? ((c) => writeCatalogFile(c)))(ranked);

  const pulled: string[] = [];
  const n = deps.prePullCount ?? 1;
  const pull = deps.pullTop ?? (async (model, provider) => { await runtimeFor(provider).control.pull(model); });
  for (const c of ranked.slice(0, n)) {
    try { await pull(c.model, c.provider); pulled.push(c.model); } catch { /* report, don't fail */ }
  }
  return { found: all.length, fits: ranked.length, pulled, path: deps.catalogPathStr ?? catalogPath() };
}
```

- [ ] **Step 4: Run** — `bun test tests/discovery/` → PASS. `bun run typecheck` → clean.

- [ ] **Step 5: Commit**
```bash
git add src/discovery/sources.ts src/discovery/build-registry.ts src/discovery/discover.ts tests/discovery/build-registry.test.ts tests/discovery/discover.test.ts
git commit -m "feat(discovery): discover pipeline + offline-safe registry builder"
```

---

