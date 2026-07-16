import { runtimeKindFor } from '../core/kind-map.ts';
import type { Capability, ModelDeclaration } from '../core/types.ts';
import { ProviderKind, RuntimeKind } from '../core/types.ts';

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
const RUNTIME_VALUES: ReadonlySet<string> = new Set(Object.values(RuntimeKind));
const PROVIDER_VALUES: ReadonlySet<string> = new Set(
  Object.values(ProviderKind),
);

/** Restore the `runtime` invariant on catalog candidates. A `Candidate` is a
 *  `ModelDeclaration`, so it carries an inference `runtime`, and every LIVE
 *  catalog source (ollama-catalog, hf-catalog, snapshot-source, huggingface-*)
 *  sets a valid one. But a PERSISTED catalog cache can violate the type: the
 *  on-disk `catalog.json` written before `runtime` was added to `Candidate`
 *  carries only `provider` (and `readCatalog` JSON.parses it with an unchecked
 *  cast, so the lie is invisible to the compiler). The download `provider`
 *  deterministically implies the inference runtime — `runtimeKindFor` is total
 *  over `ProviderKind` — so we re-derive `runtime` from `provider` whenever it
 *  is absent or not a valid `RuntimeKind`. A candidate whose `provider` is
 *  itself missing/invalid cannot resolve a runtime and is DROPPED: an omitted
 *  pullable row is graceful, an invalid one would fail `ModelListResponseSchema`
 *  and 500 the whole `GET /api/models`. */
export function normalizeCandidates(candidates: Candidate[]): Candidate[] {
  const out: Candidate[] = [];
  for (const c of candidates) {
    if (RUNTIME_VALUES.has(c.runtime as unknown as string)) {
      out.push(c);
      continue;
    }
    if (!PROVIDER_VALUES.has(c.provider as unknown as string)) continue; // unresolvable → drop
    out.push({ ...c, runtime: runtimeKindFor(c.provider) });
  }
  return out;
}

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
