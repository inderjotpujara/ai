import { runtimeKindFor } from '../../core/kind-map.ts';
import type { Capability, ProviderKind } from '../../core/types.ts';
import type {
  Candidate,
  CatalogSource,
  DiscoveryQuery,
} from '../../discovery/catalog-source.ts';
import snapshot from './snapshot.json' with { type: 'json' };

type SnapshotEntry = {
  provider: string;
  model: string;
  repo: string;
  quant?: string;
  params_billions: number;
  bytes_per_weight: number;
  file_size_bytes: number;
  downloads: number;
  role: string;
  capabilities?: string[];
};

/** Read the committed snapshot catalog into Candidates. The robustness floor. */
export function loadSnapshot(): Candidate[] {
  return (snapshot as SnapshotEntry[]).map((e) => ({
    runtime: runtimeKindFor(e.provider as ProviderKind),
    provider: e.provider as ProviderKind,
    model: e.model,
    params: {},
    role: e.role,
    capabilities: (e.capabilities ?? []) as Capability[],
    footprint: {
      approxParamsBillions: e.params_billions,
      bytesPerWeight: e.bytes_per_weight,
    },
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
export function withSnapshotFallback(
  source: CatalogSource,
  fallback: CatalogSource,
): CatalogSource {
  // Tracks whether the MOST RECENT listCandidates() call served from the
  // committed snapshot (fallback) rather than the live source, so callers
  // (the provisioner's telemetry) can report a truthful snapshotFallback
  // instead of a hardcoded value.
  let usedFallback = false;
  return {
    name: `${source.name}+snapshot`,
    appliesTo: source.appliesTo,
    async listCandidates(q: DiscoveryQuery): Promise<Candidate[]> {
      try {
        const live = await source.listCandidates(q);
        if (live.length > 0) {
          usedFallback = false;
          return live;
        }
        usedFallback = true;
        return fallback.listCandidates(q);
      } catch {
        usedFallback = true;
        return fallback.listCandidates(q);
      }
    },
    usedSnapshotFallback: () => usedFallback,
  };
}
