import type { Capability } from '../core/types.ts';
import { Capability as Cap, RuntimeKind } from '../core/types.ts';
import { providerFor } from '../provisioning/registry.ts';
import { runtimeFor } from '../runtime/registry.ts';
import {
  catalogPath,
  writeCatalog as writeCatalogFile,
} from './catalog-cache.ts';
import type {
  Candidate,
  CatalogSource,
  HostCapabilities,
} from './catalog-source.ts';
import { detectHost } from './host.ts';
import { SOURCES } from './sources.ts';

export type DiscoverDeps = {
  host?: HostCapabilities;
  sources?: CatalogSource[];
  writeCatalog?: (c: Candidate[]) => void;
  pullTop?: (model: string, candidate: Candidate) => Promise<void>;
  catalogPathStr?: string;
  prePullCount?: number;
};

export type DiscoverResult = {
  found: number;
  fits: number;
  pulled: string[];
  pullFailed: { model: string; reason: string }[];
  path: string;
};

export async function runDiscovery(
  deps: DiscoverDeps = {},
): Promise<DiscoverResult> {
  const host = deps.host ?? (await detectHost());
  const sources = (deps.sources ?? SOURCES).filter((s) => s.appliesTo(host));
  const requires: Capability[] = [Cap.Tools];

  const all: Candidate[] = [];
  for (const s of sources) {
    try {
      all.push(
        ...(await s.listCandidates({
          budgetBytes: host.liveBudgetBytes,
          requires,
          hostTotalRamBytes: host.totalRamBytes,
        })),
      );
    } catch {
      /* degrade: skip a failing source */
    }
  }
  // dedupe by (provider, base repo), keep highest downloads
  const byRepo = new Map<string, Candidate>();
  for (const c of all) {
    const key = `${c.provider}::${c.repo}`;
    const prev = byRepo.get(key);
    if (!prev || c.downloads > prev.downloads) byRepo.set(key, c);
  }
  const ranked = [...byRepo.values()].sort(
    (a, b) =>
      b.downloads - a.downloads ||
      b.footprint.approxParamsBillions - a.footprint.approxParamsBillions,
  );

  (deps.writeCatalog ?? ((c) => writeCatalogFile(c)))(ranked);

  const pulled: string[] = [];
  const pullFailed: { model: string; reason: string }[] = [];
  const n = deps.prePullCount ?? 1;
  const pull =
    deps.pullTop ??
    (async (model: string, candidate: Candidate) => {
      // Route by inference RUNTIME, not download provider: an Ollama-runtime
      // candidate pre-pulls via its local daemon, which natively resolves
      // hf.co/<repo>:<quant> refs (common when the default hfGguf/hfMlx
      // sources surface an Ollama-native model string). Every other runtime
      // downloads weights through its DownloadProvider, keyed on the
      // download `provider` kind (e.g. MLX → HF snapshot to disk).
      if (candidate.runtime === RuntimeKind.Ollama) {
        await runtimeFor(RuntimeKind.Ollama).control.pull(model);
        return;
      }
      const ctrl = new AbortController();
      const destDir =
        process.env.HF_HOME ??
        process.env.OLLAMA_MODELS ??
        `${process.cwd()}/model-images`;
      await providerFor(candidate.provider).download(model, {
        onProgress: () => {},
        signal: ctrl.signal,
        destDir,
      });
    });
  for (const c of ranked.slice(0, n)) {
    try {
      await pull(c.model, c);
      pulled.push(c.model);
    } catch (err) {
      pullFailed.push({
        model: c.model,
        reason: (err as Error).message ?? String(err),
      });
    }
  }
  return {
    found: all.length,
    fits: ranked.length,
    pulled,
    pullFailed,
    path: deps.catalogPathStr ?? catalogPath(),
  };
}
