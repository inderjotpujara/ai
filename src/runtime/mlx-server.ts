import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { MemoryError } from '../core/errors.ts';
import type { ModelDeclaration } from '../core/types.ts';
import { RuntimeKind } from '../core/types.ts';
import type { LoadedModel, Runtime } from './runtime.ts';

const BASE = process.env.MLX_BASE_URL ?? 'http://localhost:1234/v1';

const provider = createOpenAICompatible({ name: 'mlx-server', baseURL: BASE });

async function listIds(): Promise<string[]> {
  try {
    const res = await fetch(`${BASE}/models`, {
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { data?: Array<{ id: string }> };
    return (data.data ?? []).map((m) => m.id);
  } catch {
    return [];
  }
}

/**
 * MLX models run via a local OpenAI-compatible server (LM Studio / vllm-mlx).
 * The server owns model download/load, so `pull`/`warm`/`unload` are best-effort:
 * a model must be loaded in the server; we surface a clear message if it is not.
 */
export const mlxServerRuntime: Runtime = {
  kind: RuntimeKind.MlxServer,
  async isAvailable() {
    try {
      const res = await fetch(`${BASE}/models`, {
        signal: AbortSignal.timeout(1500),
      });
      return res.ok;
    } catch {
      return false;
    }
  },
  createModel: (decl: ModelDeclaration) => provider(decl.model),
  control: {
    isInstalled: async (m) => (await listIds()).includes(m),
    pull: async (m) => {
      if ((await listIds()).includes(m)) return;
      throw new Error(
        `MLX model "${m}" is not loaded in the MLX server at ${BASE}. Load it there (e.g. in LM Studio), then retry.`,
      );
    },
    warm: async () => {},
    unload: async () => {},
    listLoaded: async (): Promise<LoadedModel[]> =>
      (await listIds()).map((name) => ({ name, sizeBytes: 0 })),
    getModelMax: async () => undefined,
    getModelKvArch: async () => undefined,
    embed: async () => {
      throw new MemoryError(
        'embeddings are not supported on the MLX runtime yet',
      );
    },
  },
};
