import type { Capability } from '../core/types.ts';
import { Capability as Cap, ProviderKind, RuntimeKind } from '../core/types.ts';
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
  pullTop?: (model: string, provider: Candidate['provider']) => Promise<void>;
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
    (async (model: string, provider: Candidate['provider']) => {
      // Ollama pre-pulls via its local daemon; every other download kind
      // fetches through its DownloadProvider (e.g. MLX → HF snapshot to disk).
      if (provider === ProviderKind.Ollama) {
        await runtimeFor(RuntimeKind.Ollama).control.pull(model);
        return;
      }
      const ctrl = new AbortController();
      await providerFor(provider).download(model, {
        onProgress: () => {},
        signal: ctrl.signal,
      });
    });
  for (const c of ranked.slice(0, n)) {
    try {
      await pull(c.model, c.provider);
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
