import { ProviderError } from '../../core/errors.ts';
import { runtimeKindFor } from '../../core/kind-map.ts';
import { ProviderKind } from '../../core/types.ts';
import type {
  Candidate,
  CatalogSource,
  DiscoveryQuery,
  HostCapabilities,
} from '../../discovery/catalog-source.ts';

const HF_API = 'https://huggingface.co/api';

type TreeEntry = { path: string; size?: number };

function hfHeaders(): Record<string, string> {
  const token = process.env.HF_TOKEN; // env-fallback only; degrade to anonymous
  return token ? { authorization: `Bearer ${token}` } : {};
}

/** Pre-download size: one GGUF file's size, or the summed tree for a snapshot. */
export async function hfTreeSize(
  repoId: string,
  opts: { file?: string },
  fetchImpl: typeof fetch = fetch,
): Promise<number> {
  const res = await fetchImpl(
    `${HF_API}/models/${repoId}/tree/main?recursive=true`,
    { headers: hfHeaders() },
  );
  if (!res.ok) throw new ProviderError(`HF tree returned ${res.status}`);
  const tree = (await res.json()) as TreeEntry[];
  if (opts.file) {
    const hit = tree.find((e) => e.path === opts.file);
    if (!hit)
      throw new ProviderError(`HF file ${opts.file} not found in ${repoId}`);
    return hit.size ?? 0;
  }
  return tree.reduce((sum, e) => sum + (e.size ?? 0), 0);
}

type SearchEntry = { id: string; downloads?: number };

/** kind = which download ProviderKind fetches these weights (e.g. HfSnapshot for MLX); filter differs. */
export function createHfCatalogSource(
  kind: ProviderKind,
  deps: { filter?: string; fetchImpl?: typeof fetch } = {},
): CatalogSource {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const filter =
    deps.filter ?? (kind === ProviderKind.HfSnapshot ? 'mlx' : 'gguf');
  // Which inference runtime consumes this download kind.
  const runtime = runtimeKindFor(kind);
  return {
    name: `hf-catalog-${filter}`,
    appliesTo: (_host: HostCapabilities) => true, // HF reachable regardless of local runtime
    async listCandidates(_q: DiscoveryQuery): Promise<Candidate[]> {
      const url = `${HF_API}/models?filter=${filter}&sort=downloads&direction=-1&limit=30`;
      const res = await fetchImpl(url, { headers: hfHeaders() });
      if (!res.ok) throw new ProviderError(`HF search returned ${res.status}`);
      const entries = (await res.json()) as SearchEntry[];
      return entries.map((e) => ({
        runtime,
        provider: kind,
        model: e.id,
        params: {},
        role: 'discovered',
        footprint: { approxParamsBillions: 0, bytesPerWeight: 0.6 },
        repo: e.id,
        fileSizeBytes: 0, // lazy: enriched via hfTreeSize
        downloads: e.downloads ?? 0,
        installed: false,
      }));
    },
  };
}
