import type { Agent } from '../core/agent-def.ts';
import type { BeforeDelegate } from '../core/delegate.ts';
import { ResourceError } from '../core/errors.ts';
import type { ResourceCapture } from '../core/resource-capture.ts';
import type { ModelDeclaration } from '../core/types.ts';
import { createOllamaModel } from '../providers/ollama.ts';
import type { EnsureOpts } from '../resource/model-manager.ts';
import type { LoadedModel } from '../resource/ollama-control.ts';
import { resolveModel } from '../resource/selector.ts';

export type SelectHookDeps = {
  registry: ModelDeclaration[];
  ensureReady: (d: ModelDeclaration, o?: EnsureOpts) => Promise<number>;
  pinned: string[];
  capture: ResourceCapture;
  listLoaded?: () => Promise<LoadedModel[]>;
  /** Fired before each ensureReady attempt (e.g. to print a selection notice). */
  onAttempt?: (decl: ModelDeclaration) => void | Promise<void>;
};

/**
 * Build the onBeforeDelegate hook: resolve the agent's requirement live, bind the
 * chosen model + numCtx, and on a genuine no-fit record it in `capture` and abort
 * the delegation (rather than letting the AI SDK swallow the error).
 */
export function createSelectHook(deps: SelectHookDeps): BeforeDelegate {
  return async (agent: Agent) => {
    if (!agent.modelReq) return {};
    try {
      const { decl, numCtx } = await resolveModel(
        agent.modelReq,
        deps.registry,
        {
          ensureReady: deps.ensureReady,
          listLoaded: deps.listLoaded,
          onAttempt: deps.onAttempt,
        },
        { pinned: deps.pinned },
      );
      return { model: createOllamaModel(decl), numCtx };
    } catch (err) {
      if (err instanceof ResourceError) {
        deps.capture.error = err;
        return {
          abort: "Can't run this now — no model fits in available memory.",
        };
      }
      throw err;
    }
  };
}
