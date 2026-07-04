import type {
  Capability,
  ModelDeclaration,
  ProviderKind,
  RuntimeKind,
} from '../core/types.ts';

export class DiscoveryError extends Error {}

export type HostCapabilities = {
  totalRamBytes: number;
  liveBudgetBytes: number;
  runtimes: RuntimeKind[];
};
export type DiscoveryQuery = {
  budgetBytes: number;
  requires?: Capability[];
  hostTotalRamBytes: number;
};
export type Candidate = ModelDeclaration & {
  /** Which downloader fetches this model's weights (distinct from the inference `runtime`). */
  provider: ProviderKind;
  repo: string;
  quant?: string;
  fileSizeBytes: number;
  downloads: number;
  installed: boolean;
};
export type CatalogSource = {
  name: string;
  appliesTo(host: HostCapabilities): boolean;
  listCandidates(q: DiscoveryQuery): Promise<Candidate[]>;
  /** True when the most recent `listCandidates()` call served from the
   *  committed snapshot fallback rather than a live source. Only sources
   *  wrapped by `withSnapshotFallback` implement this; absent means "never
   *  falls back" (e.g. a plain live source, the snapshot source itself, or
   *  a test double). */
  usedSnapshotFallback?(): boolean;
};
