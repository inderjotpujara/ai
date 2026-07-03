import { ProviderKind, RuntimeKind } from './types.ts';

export type RepoShape = 'gguf-file' | 'snapshot' | 'ollama';

/** Map an inference runtime + repo shape to the download provider that fetches it. */
export function downloadKindFor(
  runtime: RuntimeKind,
  shape: RepoShape,
): ProviderKind {
  if (runtime === RuntimeKind.LmStudio) return ProviderKind.LmStudio;
  if (runtime === RuntimeKind.MlxServer) return ProviderKind.HfSnapshot;
  // RuntimeKind.Ollama:
  if (shape === 'gguf-file') return ProviderKind.HfGguf;
  return ProviderKind.Ollama;
}

/** Which inference runtime consumes a given download provider's weights. */
export function runtimeKindFor(provider: ProviderKind): RuntimeKind {
  if (provider === ProviderKind.HfSnapshot) return RuntimeKind.MlxServer;
  if (provider === ProviderKind.LmStudio) return RuntimeKind.LmStudio;
  // ProviderKind.Ollama and ProviderKind.HfGguf both run under Ollama:
  return RuntimeKind.Ollama;
}
