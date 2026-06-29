import type { Capability, ModelDeclaration, ProviderKind } from '../core/types.ts';

export class DiscoveryError extends Error {}

export type HostCapabilities = {
  totalRamBytes: number;
  liveBudgetBytes: number;
  runtimes: ProviderKind[];
};
export type DiscoveryQuery = {
  budgetBytes: number;
  requires?: Capability[];
  hostTotalRamBytes: number;
};
export type Candidate = ModelDeclaration & {
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
};
