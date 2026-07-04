import { ProviderError } from '../../core/errors.ts';
import { ProviderKind, RuntimeKind } from '../../core/types.ts';
import type {
  Candidate,
  CatalogSource,
  DiscoveryQuery,
  HostCapabilities,
} from '../../discovery/catalog-source.ts';

const REGISTRY = 'https://registry.ollama.ai/v2/library';

type Manifest = {
  config?: { size?: number };
  layers?: Array<{ size?: number }>;
};

/** Authoritative pre-pull size: sum layers[].size (+ config.size) from the registry manifest. */
export async function ollamaManifestSize(
  model: string,
  tag: string,
  fetchImpl: typeof fetch = fetch,
): Promise<number> {
  let res: Response;
  try {
    res = await fetchImpl(`${REGISTRY}/${model}/manifests/${tag}`);
  } catch (cause) {
    throw new ProviderError('Ollama registry manifest fetch failed', { cause });
  }
  if (!res.ok)
    throw new ProviderError(`Ollama registry manifest returned ${res.status}`);
  const m = (await res.json()) as Manifest;
  const layers = (m.layers ?? []).reduce((sum, l) => sum + (l.size ?? 0), 0);
  return layers + (m.config?.size ?? 0);
}

// Community catalog JSON (list only; sizes enriched lazily via the manifest above).
const CATALOG_JSON =
  'https://raw.githubusercontent.com/chrizzo84/OllamaScraper/refs/heads/main/out/ollama_models.json';

type CatalogEntry = {
  name?: string;
  tag?: string;
  size_bytes?: number;
  pulls?: number;
};

export function createOllamaCatalogSource(
  deps: { fetchImpl?: typeof fetch } = {},
): CatalogSource {
  const fetchImpl = deps.fetchImpl ?? fetch;
  return {
    name: 'ollama-catalog',
    appliesTo: (host: HostCapabilities) =>
      host.runtimes.includes(RuntimeKind.Ollama),
    async listCandidates(_q: DiscoveryQuery): Promise<Candidate[]> {
      const res = await fetchImpl(CATALOG_JSON);
      if (!res.ok)
        throw new ProviderError(`Ollama catalog JSON returned ${res.status}`);
      const entries = (await res.json()) as CatalogEntry[];
      return entries
        .filter((e) => e.name)
        .map((e) => ({
          runtime: RuntimeKind.Ollama,
          provider: ProviderKind.Ollama,
          model: e.tag ? `${e.name}:${e.tag}` : (e.name as string),
          params: {},
          role: 'discovered',
          footprint: { approxParamsBillions: 0, bytesPerWeight: 0.6 },
          repo: e.name as string,
          quant: e.tag,
          fileSizeBytes: e.size_bytes ?? 0, // lazy: 0 until enriched
          downloads: e.pulls ?? 0,
          installed: false,
        }));
    },
  };
}
