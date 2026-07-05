import { RuntimeKind } from '../../core/types.ts';
import { probeTimeoutMs } from '../../reliability/config.ts';
import type {
  LaunchSpec,
  RuntimeStrategy,
} from '../managed-openai-compatible.ts';

/** Where to probe for an already-running MLX server when nothing else says otherwise. */
const DEFAULT_MLX_BASE_URL =
  process.env.MLX_BASE_URL ?? 'http://localhost:1234/v1';

export type MlxStrategyDeps = {
  /** Injectable PATH lookup; defaults to `Bun.which`. Tests inject a fake so
   * `detect()` doesn't depend on a real `mlx_lm` install. */
  which?: (cmd: string) => string | null;
};

/**
 * MLX inference runtime: a managed `mlx_lm.server` process with a fixed
 * context window (mlx_lm.server has no context-length flag, so `numCtx` is
 * never applied — the model's own trained context is used as-is).
 */
export function createMlxStrategy(deps: MlxStrategyDeps = {}): RuntimeStrategy {
  const which = deps.which ?? Bun.which;

  return {
    kind: RuntimeKind.MlxServer,
    contextCapability: 'fixed',
    defaultPort: 1234,
    healthPath: '/v1/models',
    basePath: '/v1',
    async detect(): Promise<boolean> {
      try {
        const res = await fetch(`${DEFAULT_MLX_BASE_URL}/models`, {
          signal: AbortSignal.timeout(probeTimeoutMs()),
        });
        if (res.ok) return true;
      } catch {
        // no server reachable at the configured URL; fall back to the binary check
      }
      return which('mlx_lm.server') != null;
    },
    launch(model, _numCtx, port): LaunchSpec {
      return {
        cmd: 'mlx_lm.server',
        args: ['--model', model, '--host', '127.0.0.1', '--port', String(port)],
        port,
      };
    },
  };
}

export const mlxStrategy: RuntimeStrategy = createMlxStrategy();
