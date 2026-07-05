import { existsSync } from 'node:fs';
import { RuntimeKind } from '../../core/types.ts';
import {
  createManagedRuntime,
  type LaunchSpec,
  type RuntimeStrategy,
} from '../managed-openai-compatible.ts';
import type { Runtime } from '../runtime.ts';

export type LlamaCppDeps = {
  /** Injectable PATH lookup; defaults to `Bun.which`. Tests inject a fake so
   * `detect()` doesn't depend on a real `llama-server` install. */
  which?: (cmd: string) => string | null;
};

/** Path-like prefixes that unambiguously mean "local filesystem path", even
 * when the file doesn't exist yet (e.g. a not-yet-downloaded weights path). */
const PATH_PREFIXES = ['/', './', '../', '~'];

/**
 * True when `model` looks like a HuggingFace repo id (e.g. `"org/repo"` or
 * `"org/repo:Q4_K_M"`) that `llama-server -hf` can resolve, rather than a
 * local GGUF path. A `/`-containing string is a path if it starts with an
 * absolute/relative/home prefix, or already exists on disk; otherwise it's
 * treated as an `org/repo` id.
 */
function looksLikeHfRepoId(model: string): boolean {
  if (!model.includes('/')) return false;
  if (PATH_PREFIXES.some((p) => model.startsWith(p))) return false;
  return !existsSync(model);
}

/** llama.cpp inference runtime: a managed `llama-server` process with a
 * dynamic context window (relaunch to change `-c`). `deps` injects the PATH
 * lookup used by `detect()` so it's testable without a real install. */
export function createLlamaCppStrategy(
  deps: LlamaCppDeps = {},
): RuntimeStrategy {
  const which = deps.which ?? Bun.which;

  return {
    kind: RuntimeKind.LlamaCpp,
    contextCapability: 'relaunch',
    defaultPort: 8080,
    healthPath: '/health',
    basePath: '/v1',
    async detect(): Promise<boolean> {
      return which('llama-server') != null;
    },
    launch(model, numCtx, port): LaunchSpec {
      const modelArgs = looksLikeHfRepoId(model)
        ? ['-hf', model]
        : ['-m', model];
      return {
        cmd: 'llama-server',
        args: [
          ...modelArgs,
          ...(numCtx ? ['-c', String(numCtx)] : []),
          '--host',
          '127.0.0.1',
          '--port',
          String(port),
        ],
        port,
      };
    },
  };
}

export const llamaCppStrategy: RuntimeStrategy = createLlamaCppStrategy();
export const llamaCppRuntime: Runtime = createManagedRuntime(llamaCppStrategy);
