import { ProviderKind } from '../core/types.ts';
import type {
  Candidate,
  CatalogSource,
  HostCapabilities,
} from '../discovery/catalog-source.ts';
import { createHfCatalogSource, hfTreeSize } from './catalog/hf-catalog.ts';
import {
  createOllamaCatalogSource,
  ollamaManifestSize,
} from './catalog/ollama-catalog.ts';
import {
  createSnapshotSource,
  withSnapshotFallback,
} from './catalog/snapshot-source.ts';
import { createHfFetchProvider } from './providers/hf-fetch.ts';
import { createLmStudioProvider } from './providers/lmstudio.ts';
import { createOllamaProvider } from './providers/ollama.ts';
import type { DownloadProvider } from './types.ts';

export function providerFor(kind: ProviderKind): DownloadProvider {
  switch (kind) {
    case ProviderKind.Ollama:
      return createOllamaProvider();
    case ProviderKind.HfGguf:
      return createHfFetchProvider(ProviderKind.HfGguf);
    case ProviderKind.HfSnapshot:
      return createHfFetchProvider(ProviderKind.HfSnapshot);
    case ProviderKind.LmStudio:
      return createLmStudioProvider();
    default:
      return createOllamaProvider();
  }
}

export function catalogSourcesFor(_host: HostCapabilities): CatalogSource[] {
  const snap = createSnapshotSource();
  return [
    withSnapshotFallback(createOllamaCatalogSource(), snap),
    withSnapshotFallback(
      createHfCatalogSource(ProviderKind.HfSnapshot),
      snap,
    ),
  ];
}

/** Lazy size enrichment routed by provider. */
export async function enrichSize(c: Candidate): Promise<number> {
  if (c.provider === ProviderKind.Ollama) {
    const [model, tag = 'latest'] = c.model.split(':');
    return ollamaManifestSize(model ?? c.model, tag);
  }
  return hfTreeSize(c.repo, {}); // HF snapshot sum
}
