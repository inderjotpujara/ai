import type { ModelDeclaration } from '../../core/types.ts';
import { buildRegistry as realBuildRegistry } from '../../discovery/build-registry.ts';
import { readCatalog as realReadCatalog } from '../../discovery/catalog-cache.ts';
import {
  type Candidate,
  normalizeCandidates,
} from '../../discovery/catalog-source.ts';
import { detectHost as realDetectHost } from '../../discovery/host.ts';
import { type FitCandidate, fitAndRank } from '../../provisioning/fit.ts';

export type ModelDiscoveryDeps = {
  buildRegistry?: () => Promise<ModelDeclaration[]>;
  readCatalog?: () => Candidate[] | undefined;
  detectHost?: () => Promise<{ liveBudgetBytes: number }>;
};

export type ModelDiscovery = {
  installed: ModelDeclaration[];
  pullable: FitCandidate[];
};

/** Composes the same building blocks `runProvision` uses (see plan Task 16's
 *  design note) — read-only, no download side-effect, no live network
 *  re-discovery on every call. */
export async function discoverModels(
  deps: ModelDiscoveryDeps = {},
): Promise<ModelDiscovery> {
  const installed = await (deps.buildRegistry ?? realBuildRegistry)();
  const host = await (deps.detectHost ?? realDetectHost)();
  // A persisted catalog cache may predate the `runtime` field (or hold a stale
  // value); re-derive it from `provider` so every pullable row carries a valid
  // RuntimeKind. See normalizeCandidates for the data-model rationale.
  const catalog = normalizeCandidates(
    (deps.readCatalog ?? realReadCatalog)() ?? [],
  );
  const pullable = fitAndRank(catalog, host.liveBudgetBytes);
  return { installed, pullable };
}
