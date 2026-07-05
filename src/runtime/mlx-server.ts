import { probeTimeoutMs } from '../reliability/config.ts';
import {
  createManagedRuntime,
  type RuntimeStrategy,
} from './managed-openai-compatible.ts';
import type { SpawnFn } from './process-supervisor.ts';
import type { Runtime } from './runtime.ts';
import { mlxStrategy } from './strategies/mlx.ts';

// Resolved per-call (not captured once) so tests can swap `globalThis.fetch`
// after the runtime is constructed without needing to pass `fetchImpl`.
const dynamicFetch = ((input, init) => fetch(input, init)) as typeof fetch;

export type MlxServerDeps = {
  /** When set (or `MLX_BASE_URL` is set in the environment), the MLX server is
   * treated as already running at this URL: no process is spawned, and `warm`
   * is a no-op reachability path. Only when neither is set does `warm` spawn
   * `mlx_lm.server` itself. */
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  spawn?: SpawnFn;
};

/** Builds the compat strategy for an externally-configured MLX server: the
 * server is assumed already running at `baseUrl`, so `warm` never spawns a
 * process — it just adopts that URL as the current connection. */
function externalServerStrategy(
  baseUrl: string,
  fetchImpl: typeof fetch,
): { strategy: RuntimeStrategy; host: string } {
  const url = new URL(baseUrl);
  const port = url.port
    ? Number(url.port)
    : url.protocol === 'https:'
      ? 443
      : 80;
  const basePath = url.pathname || '/v1';

  const strategy: RuntimeStrategy = {
    ...mlxStrategy,
    defaultPort: port,
    basePath,
    async detect(): Promise<boolean> {
      try {
        const res = await fetchImpl(`${baseUrl}/models`, {
          signal: AbortSignal.timeout(probeTimeoutMs()),
        });
        return res.ok;
      } catch {
        return false;
      }
    },
    async daemonLoad() {
      return { baseUrl };
    },
  };

  return { strategy, host: url.hostname };
}

/**
 * MLX models run either via a local OpenAI-compatible server that's already
 * running (LM Studio / vllm-mlx / a manually-started `mlx_lm.server`), or —
 * when nothing else answers — a `mlx_lm.server` process this runtime spawns
 * and supervises itself (fixed context: `mlx_lm.server` has no context-length
 * flag, so `numCtx` is never threaded through).
 *
 * `deps` injects the base URL, fetch implementation, and spawn function so
 * this is testable without a live server or a real process.
 */
export function createMlxServerRuntime(deps: MlxServerDeps = {}): Runtime {
  const configuredBaseUrl = deps.baseUrl ?? process.env.MLX_BASE_URL;
  const fetchImpl = deps.fetchImpl ?? dynamicFetch;

  if (configuredBaseUrl) {
    const { strategy, host } = externalServerStrategy(
      configuredBaseUrl,
      fetchImpl,
    );
    return createManagedRuntime(strategy, { host, fetchImpl });
  }

  return createManagedRuntime(mlxStrategy, {
    fetchImpl,
    spawn: deps.spawn,
  });
}

export const mlxServerRuntime: Runtime = createMlxServerRuntime();
