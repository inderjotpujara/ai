import type { Capability } from '../core/types.ts';
import { Capability as Cap } from '../core/types.ts';
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
  const n = deps.prePullCount ?? 1;
  const pull =
    deps.pullTop ??
    (async (model, provider) => {
      await runtimeFor(provider).control.pull(model);
    });
  for (const c of ranked.slice(0, n)) {
    try {
      await pull(c.model, c.provider);
      pulled.push(c.model);
    } catch {
      /* report, don't fail */
    }
  }
  return {
    found: all.length,
    fits: ranked.length,
    pulled,
    path: deps.catalogPathStr ?? catalogPath(),
  };
}
