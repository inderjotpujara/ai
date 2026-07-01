import { embedMany } from 'ai';
import { createOllama } from 'ollama-ai-provider-v2';
import { ProviderKind } from '../core/types.ts';
import { createOllamaModel } from '../providers/ollama.ts';
import {
  getModelKvArch,
  getModelMaxContext,
  isModelInstalled,
  listLoadedModels,
  pullModel,
  unloadModel,
  warmModel,
} from '../resource/ollama-control.ts';
import type { Runtime } from './runtime.ts';

const BASE = 'http://localhost:11434';
// The provider's baseURL needs the /api suffix (matches src/providers/ollama.ts).
const OLLAMA_API_BASE_URL = `${BASE}/api`;

/** Embed a batch of texts via the Ollama embeddings API (AI SDK `embedMany`). */
async function ollamaEmbed(
  model: string,
  texts: string[],
): Promise<number[][]> {
  const ollama = createOllama({ baseURL: OLLAMA_API_BASE_URL });
  const { embeddings } = await embedMany({
    model: ollama.textEmbeddingModel(model),
    values: texts,
  });
  return embeddings;
}

export const ollamaRuntime: Runtime = {
  kind: ProviderKind.Ollama,
  async isAvailable() {
    try {
      const res = await fetch(`${BASE}/api/version`, {
        signal: AbortSignal.timeout(1500),
      });
      return res.ok;
    } catch {
      return false;
    }
  },
  createModel: (decl) => createOllamaModel(decl),
  control: {
    isInstalled: (m) => isModelInstalled(m),
    pull: (m) => pullModel(m),
    warm: (m, n) => warmModel(m, n),
    unload: (m) => unloadModel(m),
    listLoaded: () => listLoadedModels(),
    getModelMax: (m) => getModelMaxContext(m),
    getModelKvArch: (m) => getModelKvArch(m),
    embed: (m, texts) => ollamaEmbed(m, texts),
  },
};
