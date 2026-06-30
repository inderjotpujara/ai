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
  },
};
