import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { MemoryError } from '../core/errors.ts';
import type { ModelDeclaration } from '../core/types.ts';
import { RuntimeKind } from '../core/types.ts';
import type { LoadedModel, Runtime } from './runtime.ts';

const MLX_BASE_URL = process.env.MLX_BASE_URL ?? 'http://localhost:1234/v1';

/** A single entry from the OpenAI-compatible `GET /models` payload. Fields beyond
 * `id` are non-standard extensions some servers (LM Studio, vllm-mlx) add. */
type MlxModelEntry = {
  id: string;
  max_context_length?: number;
  context_length?: number;
  max_model_len?: number;
  size_bytes?: number;
  size?: number;
};

type MlxModelsResponse = { data?: MlxModelEntry[] };

/** The context length field, if the server reports one under any known name. */
function contextLengthOf(entry: MlxModelEntry): number | undefined {
  const v =
    entry.max_context_length ?? entry.context_length ?? entry.max_model_len;
  return typeof v === 'number' ? v : undefined;
}

/** The on-disk/in-memory size field, if the server reports one; else 0 (honest fallback). */
function sizeBytesOf(entry: MlxModelEntry): number {
  const v = entry.size_bytes ?? entry.size;
  return typeof v === 'number' ? v : 0;
}

export type MlxServerDeps = {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
};

/**
 * MLX models run via a local OpenAI-compatible server (LM Studio / vllm-mlx).
 * The server owns model download/load, so `pull`/`warm`/`unload` are best-effort:
 * a model must be loaded in the server; we surface a clear message if it is not.
 *
 * `deps` injects the base URL and fetch implementation so this is testable
 * without a live server.
 */
export function createMlxServerRuntime(deps?: MlxServerDeps): Runtime {
  const baseUrl = deps?.baseUrl ?? MLX_BASE_URL;
  // Resolved per-call (not captured once) so tests can swap `globalThis.fetch`
  // after the runtime is constructed without needing to pass `fetchImpl`.
  const getFetch = (): typeof fetch => deps?.fetchImpl ?? fetch;
  const provider = createOpenAICompatible({
    name: 'mlx-server',
    baseURL: baseUrl,
  });

  async function listModels(): Promise<MlxModelEntry[]> {
    try {
      const res = await getFetch()(`${baseUrl}/models`, {
        signal: AbortSignal.timeout(1500),
      });
      if (!res.ok) return [];
      const data = (await res.json()) as MlxModelsResponse;
      return data.data ?? [];
    } catch {
      return [];
    }
  }

  async function listIds(): Promise<string[]> {
    return (await listModels()).map((m) => m.id);
  }

  return {
    kind: RuntimeKind.MlxServer,
    async isAvailable() {
      try {
        const res = await getFetch()(`${baseUrl}/models`, {
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
        // The OpenAI-compatible surface has no standard "load a model" endpoint
        // (LM Studio's load is a GUI/CLI action, not a documented REST call), so
        // there is nothing reliable to attempt here — degrade with a clear error.
        throw new Error(
          `MLX model "${m}" is not loaded in the MLX server at ${baseUrl}. Load it there (e.g. in LM Studio), then retry.`,
        );
      },
      warm: async () => {},
      unload: async () => {},
      listLoaded: async (): Promise<LoadedModel[]> =>
        (await listModels()).map((m) => ({
          name: m.id,
          sizeBytes: sizeBytesOf(m),
        })),
      getModelMax: async (m) => {
        const entry = (await listModels()).find((e) => e.id === m);
        return entry ? contextLengthOf(entry) : undefined;
      },
      // MLX servers don't expose llama.cpp-style architecture/attention metadata —
      // honestly unavailable, not derivable from the OpenAI-compatible surface.
      getModelKvArch: async () => undefined,
      embed: async () => {
        throw new MemoryError(
          'embeddings are not supported on the MLX runtime yet',
        );
      },
    },
  };
}

export const mlxServerRuntime: Runtime = createMlxServerRuntime();
