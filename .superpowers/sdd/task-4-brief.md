### Task 4: Provisioner orchestration + `provision` CLI + auto-detect hook

**Files:**
- Create: `src/provisioning/provisioner.ts` (orchestration: detect → discover → fit → enrich → consent → download → verify)
- Create: `src/provisioning/registry.ts` (`providerFor(kind)` + `catalogSourcesFor(host)`)
- Create: `src/provisioning/detect-missing.ts` (which declared models aren't installed)
- Create: `src/cli/provision.ts` (the `bun run provision` entry)
- Modify: `package.json` (add `"provision": "bun run src/cli/provision.ts"`)
- Modify: `src/cli/chat.ts` (auto-detect hook: offer provisioning when required models missing)
- Test: `tests/provisioning/provisioner.test.ts`
- Test: `tests/provisioning/detect-missing.test.ts`

**Interfaces:**
- Consumes: `detectHost` (discovery/host); `fitAndRank`/`FitCandidate` (fit); catalog sources + `withSnapshotFallback` (Task 3); `DownloadProvider` (Task 1–2); `askYesNo`/`selectModels`/`stdinInput` + `ProgressBar` (Task 1); `isModelInstalled` (ollama-control); `enrichSize` (defined here).
- Produces:
  - `type ProvisionResult = { downloaded: string[]; declined: string[]; failed: Array<{ model: string; error: string }>; deferred: string[] }`
  - `runProvision(opts: { deps?: ProvisionDeps; autoYes?: boolean }): Promise<ProvisionResult>`
  - `type ProvisionDeps = { detectHost; catalogSources; providerFor; enrichSize; ui }` (all injectable for tests)
  - `providerFor(kind: ProviderKind): DownloadProvider`
  - `detectMissing(declared: ModelDeclaration[], isInstalled: (m: string) => Promise<boolean>): Promise<ModelDeclaration[]>`

- [ ] **Step 1: Write failing test for `detectMissing`.**

```ts
// tests/provisioning/detect-missing.test.ts
import { describe, expect, it } from 'bun:test';
import { detectMissing } from '../../src/provisioning/detect-missing.ts';
import { ProviderKind } from '../../src/core/types.ts';

const decl = (model: string) => ({ provider: ProviderKind.Ollama, model, params: {}, role: 'x', footprint: { approxParamsBillions: 4, bytesPerWeight: 0.6 } });

describe('detectMissing', () => {
  it('returns only the declared models that are not installed', async () => {
    const installed = new Set(['a']);
    const out = await detectMissing([decl('a'), decl('b')], async (m) => installed.has(m));
    expect(out.map((d) => d.model)).toEqual(['b']);
  });
});
```

- [ ] **Step 2: Run, verify fail; then create `src/provisioning/detect-missing.ts`.**

```ts
import type { ModelDeclaration } from '../core/types.ts';

/** The declared models not yet installed — the set provisioning offers to pull. */
export async function detectMissing(
  declared: ModelDeclaration[],
  isInstalled: (model: string) => Promise<boolean>,
): Promise<ModelDeclaration[]> {
  const missing: ModelDeclaration[] = [];
  for (const d of declared) {
    if (!(await isInstalled(d.model))) missing.push(d);
  }
  return missing;
}
```

- [ ] **Step 3: Run, verify pass.**

Run: `bun test tests/provisioning/detect-missing.test.ts`
Expected: PASS.

- [ ] **Step 4: Write failing test for `runProvision` (fully injected deps; asserts consent + download + degrade).**

```ts
// tests/provisioning/provisioner.test.ts
import { describe, expect, it } from 'bun:test';
import { runProvision } from '../../src/provisioning/provisioner.ts';
import { ProviderKind } from '../../src/core/types.ts';
import { DownloadPhase } from '../../src/provisioning/types.ts';

const host = { totalRamBytes: 24e9, liveBudgetBytes: 8e9, runtimes: [ProviderKind.Ollama] };
const cand = (model: string, size: number) => ({
  provider: ProviderKind.Ollama, model, params: {}, role: 'x',
  footprint: { approxParamsBillions: 4, bytesPerWeight: 0.6 },
  repo: model, fileSizeBytes: size, downloads: 1, installed: false,
});

function deps(overrides = {}) {
  const downloaded: string[] = [];
  return {
    downloaded,
    detectHost: async () => host,
    catalogSources: [{ name: 's', appliesTo: () => true, listCandidates: async () => [cand('qwen3.5:4b', 3e9)] }],
    providerFor: () => ({
      kind: ProviderKind.Ollama,
      download: async (m: string, o: any) => {
        o.onProgress({ modelRef: m, phase: DownloadPhase.Done, bytesCompleted: 3e9, bytesTotal: 3e9, percent: 100, speedBytesPerSec: 1 });
        downloaded.push(m);
      },
    }),
    enrichSize: async (c: any) => c.fileSizeBytes,
    freeDiskBytes: async () => 500e9,
    ui: { askYesNo: async () => true, selectModels: async (items: any[]) => items.filter((i) => i.recommended), bar: { render() {}, done() {} } },
    ...overrides,
  };
}

describe('runProvision', () => {
  it('downloads the consented recommended model', async () => {
    const d = deps();
    const res = await runProvision({ deps: d, autoYes: false });
    expect(res.downloaded).toEqual(['qwen3.5:4b']);
    expect(d.downloaded).toEqual(['qwen3.5:4b']);
  });

  it('records nothing downloaded when consent is declined', async () => {
    const res = await runProvision({ deps: deps({ ui: { askYesNo: async () => false, selectModels: async () => [], bar: { render() {}, done() {} } }) }, autoYes: false });
    expect(res.downloaded).toEqual([]);
  });

  it('degrades: a failing download is recorded in failed, others still proceed', async () => {
    const d = deps({
      catalogSources: [{ name: 's', appliesTo: () => true, listCandidates: async () => [cand('good', 3e9), cand('bad', 3e9)] }],
      providerFor: () => ({
        kind: ProviderKind.Ollama,
        download: async (m: string) => { if (m === 'bad') throw new Error('pull failed'); },
      }),
      ui: { askYesNo: async () => true, selectModels: async (items: any[]) => items, bar: { render() {}, done() {} } },
    });
    const res = await runProvision({ deps: d, autoYes: false });
    expect(res.failed.map((f) => f.model)).toContain('bad');
    expect(res.downloaded).toContain('good');
  });
});
```

- [ ] **Step 5: Run, verify fail; then create `src/provisioning/provisioner.ts`.**

```ts
import type { HostCapabilities, Candidate, CatalogSource } from '../discovery/catalog-source.ts';
import type { ProviderKind } from '../core/types.ts';
import { fitAndRank, type FitCandidate } from './fit.ts';
import { checkDiskSpace } from './supervisor.ts';
import { type DownloadProgress, type DownloadProvider } from './types.ts';

export type ProvisionResult = {
  downloaded: string[];
  declined: string[];
  failed: Array<{ model: string; error: string }>;
  deferred: string[];
};

export type ProvisionUi = {
  askYesNo: (q: string) => Promise<boolean>;
  selectModels: (items: FitCandidate[]) => Promise<FitCandidate[]>;
  bar: { render: (p: DownloadProgress) => void; done: (p: DownloadProgress) => void };
};

export type ProvisionDeps = {
  detectHost: () => Promise<HostCapabilities>;
  catalogSources: CatalogSource[];
  providerFor: (kind: ProviderKind) => DownloadProvider;
  enrichSize: (c: Candidate) => Promise<number>;
  freeDiskBytes: () => Promise<number>;
  ui: ProvisionUi;
};

/** Orchestrates the first-boot flow. All deps injectable; degrade-never-crash. */
export async function runProvision(
  opts: { deps: ProvisionDeps; autoYes?: boolean },
): Promise<ProvisionResult> {
  const { deps } = opts;
  const result: ProvisionResult = { downloaded: [], declined: [], failed: [], deferred: [] };

  const host = await deps.detectHost();

  // 1) Discover across applicable sources; degrade per-source (a throw yields []).
  const query = { budgetBytes: host.liveBudgetBytes, hostTotalRamBytes: host.totalRamBytes };
  const lists = await Promise.all(
    deps.catalogSources
      .filter((s) => s.appliesTo(host))
      .map((s) => s.listCandidates(query).catch(() => [] as Candidate[])),
  );
  const candidates = lists.flat();

  // 2) Fit-filter + rank; recommended pre-marked.
  const ranked = fitAndRank(candidates, host.liveBudgetBytes);
  if (ranked.length === 0) return result;

  // 3) Enrich sizes for the shown set (lazy; degrade to existing size on failure).
  for (const c of ranked) {
    if (c.fileSizeBytes <= 0) {
      try {
        c.fileSizeBytes = await deps.enrichSize(c);
      } catch {
        /* leave as-is; UI shows best-effort size */
      }
    }
  }

  // 4) Consent: per-model selection (recommended pre-selected).
  const selected = await deps.ui.selectModels(ranked);
  if (selected.length === 0) return result;

  // 5) Disk preflight over the selected set.
  const required = selected.reduce((s, c) => s + Math.max(c.fileSizeBytes, c.estimatedBytes), 0);
  const free = await deps.freeDiskBytes();
  const pre = checkDiskSpace({ requiredBytes: required, freeBytes: free });
  if (!pre.ok) {
    const ok = await deps.ui.askYesNo(
      `Need ~${Math.round(required / 1e9)}GB but only ~${Math.round(free / 1e9)}GB free (short ~${Math.round(pre.shortfallBytes / 1e9)}GB). Continue anyway?`,
    );
    if (!ok) {
      for (const c of selected) result.declined.push(c.model);
      return result;
    }
  }

  // 6) Sequential download with a live bar; degrade-never-crash per model.
  const ctrl = new AbortController();
  for (const c of selected) {
    try {
      const provider = deps.providerFor(c.provider);
      await provider.download(c.model, { onProgress: (p) => deps.ui.bar.render(p), signal: ctrl.signal });
      result.downloaded.push(c.model);
    } catch (err) {
      result.failed.push({ model: c.model, error: (err as Error).message });
    }
  }
  return result;
}
```

- [ ] **Step 6: Run, verify pass.**

Run: `bun test tests/provisioning/provisioner.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Create `src/provisioning/registry.ts` (wire real providers + sources; no test — thin composition of tested units).**

```ts
import { ProviderKind } from '../core/types.ts';
import type { Candidate, CatalogSource, HostCapabilities } from '../discovery/catalog-source.ts';
import { createHfCatalogSource } from './catalog/hf-catalog.ts';
import { createOllamaCatalogSource, ollamaManifestSize } from './catalog/ollama-catalog.ts';
import { createSnapshotSource, withSnapshotFallback } from './catalog/snapshot-source.ts';
import { hfTreeSize } from './catalog/hf-catalog.ts';
import { createOllamaProvider } from './providers/ollama.ts';
import { createHfFetchProvider } from './providers/hf-fetch.ts'; // Task 5
import { createLmStudioProvider } from './providers/lmstudio.ts'; // Task 5
import type { DownloadProvider } from './types.ts';

export function providerFor(kind: ProviderKind): DownloadProvider {
  switch (kind) {
    case ProviderKind.Ollama:
      return createOllamaProvider();
    case ProviderKind.MlxServer:
      return createHfFetchProvider(ProviderKind.MlxServer); // MLX snapshot via HF
    default:
      return createOllamaProvider();
  }
}

export function catalogSourcesFor(_host: HostCapabilities): CatalogSource[] {
  const snap = createSnapshotSource();
  return [
    withSnapshotFallback(createOllamaCatalogSource(), snap),
    withSnapshotFallback(createHfCatalogSource(ProviderKind.MlxServer), snap),
  ];
}

/** Lazy size enrichment routed by provider. */
export async function enrichSize(c: Candidate): Promise<number> {
  if (c.provider === ProviderKind.Ollama) {
    const [model, tag = 'latest'] = c.model.split(':');
    return ollamaManifestSize(model, tag);
  }
  return hfTreeSize(c.repo, {}); // MLX snapshot sum
}
```

Note: `createHfFetchProvider` / `createLmStudioProvider` are Task 5. This file imports them so Task 5 completes the wiring; until then, comment those two imports and the `MlxServer` case to keep Task 4 self-contained (re-enable in Task 5, Step 9).

- [ ] **Step 8: Create `src/cli/provision.ts`.**

```ts
import { detectHost } from '../discovery/host.ts';
import { catalogSourcesFor, enrichSize, providerFor } from '../provisioning/registry.ts';
import { runProvision } from '../provisioning/provisioner.ts';
import { ProgressBar } from '../provisioning/ui/progress-bar.ts';
import { askYesNo, selectModels, stdinInput } from '../provisioning/ui/prompt.ts';
import { formatBytes } from '../provisioning/ui/format.ts';

async function freeDiskBytes(): Promise<number> {
  // statfs on the models volume; conservative fallback keeps preflight non-fatal.
  try {
    const { statfs } = await import('node:fs/promises');
    const s = await statfs(process.env.OLLAMA_MODELS ?? process.cwd());
    return s.bavail * s.bsize;
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}

async function main(): Promise<void> {
  const autoYes = process.env.AGENT_PROVISION_AUTO_YES === '1';
  const input = stdinInput();
  const bar = new ProgressBar(process.stderr, process.stderr.isTTY ?? false);
  const host = await detectHost();
  const result = await runProvision({
    autoYes,
    deps: {
      detectHost: async () => host,
      catalogSources: catalogSourcesFor(host),
      providerFor,
      enrichSize,
      freeDiskBytes,
      ui: {
        askYesNo: (q) => askYesNo(q, { input, autoYes }),
        selectModels: (items) =>
          selectModels(items, {
            input,
            autoYes,
            label: (c) => `${c.model}  (${formatBytes(c.fileSizeBytes || c.estimatedBytes)})`,
          }),
        bar,
      },
    },
  });
  console.error(
    `\nProvisioned: ${result.downloaded.length} · declined: ${result.declined.length} · failed: ${result.failed.length}`,
  );
  if (result.failed.length > 0) process.exitCode = 1;
}

await main();
```

- [ ] **Step 9: Add the `provision` script to `package.json`.**

Modify `package.json` scripts (after `"memory": ...`):
```json
    "memory": "bun run src/cli/memory.ts",
    "provision": "bun run src/cli/provision.ts"
```

- [ ] **Step 10: Wire the auto-detect hook into `src/cli/chat.ts`.**

Read `src/cli/chat.ts` around the `createModelManager()` / `ensureReady` block (lines ~30–40 per the seam map). Before the first `ensureReady`, add a guarded offer (import `detectMissing`, `isModelInstalled`, `runProvision` deps). Minimal, non-invasive:

```ts
// near the top of chat.ts main(), before ensureReady:
import { isModelInstalled } from '../resource/ollama-control.ts';
import { detectMissing } from '../provisioning/detect-missing.ts';
import { BOOTSTRAP } from '../../models/registry.ts';
import { runProvision } from '../provisioning/provisioner.ts';
import { catalogSourcesFor, enrichSize, providerFor } from '../provisioning/registry.ts';
// ... (ProgressBar + prompt imports as in provision.ts)

const missing = await detectMissing(BOOTSTRAP, (m) => isModelInstalled(m));
if (missing.length > 0 && (process.stderr.isTTY ?? false)) {
  const ok = await askYesNo(
    `${missing.length} required model(s) not installed: ${missing.map((m) => m.model).join(', ')}. Provision now?`,
    { input: stdinInput(), autoYes: process.env.AGENT_PROVISION_AUTO_YES === '1' },
  );
  if (ok) {
    const host = await detectHost();
    await runProvision({ deps: { /* same wiring as provision.ts */ } });
  }
}
```

Keep it behind the TTY + consent gate so non-interactive `chat` runs are unaffected. Factor the shared deps-wiring from `provision.ts` into a small `src/provisioning/cli-deps.ts` helper to avoid duplication (DRY) and import it in both.

- [ ] **Step 11: Typecheck, lint, run full provisioning suite.**

Run: `bun run typecheck && bun run lint:file -- "src/provisioning/**/*.ts" "src/cli/provision.ts" "src/cli/chat.ts" && bun test tests/provisioning/`
Expected: clean + all PASS.

- [ ] **Step 12: LIVE-VERIFY the end-to-end CLI (Ollama).**

Run: with `ollama serve` up and (temporarily) a model uninstalled — `AGENT_PROVISION_AUTO_YES=1 bun run provision`.
Expected: detects host (24 GB), lists fitting candidates, downloads the recommended set with a live bar, prints the summary, exit 0. Confirm with `ollama list`. Record in the SDD ledger.

- [ ] **Step 13: Commit.**

```bash
git add src/provisioning/provisioner.ts src/provisioning/registry.ts src/provisioning/detect-missing.ts src/provisioning/cli-deps.ts src/cli/provision.ts src/cli/chat.ts package.json tests/provisioning/provisioner.test.ts tests/provisioning/detect-missing.test.ts
git commit -m "feat(provisioning): provisioner orchestration + provision CLI + auto-detect hook, live-verified (Slice 14 Task 4)"
```

---

