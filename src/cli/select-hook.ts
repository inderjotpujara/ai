import type { Agent } from '../core/agent-def.ts';
import type { BeforeDelegate } from '../core/delegate.ts';
import { ResourceError } from '../core/errors.ts';
import type { ResourceCapture } from '../core/resource-capture.ts';
import { type ModelDeclaration, RuntimeKind } from '../core/types.ts';
import type { EnsureOpts } from '../resource/model-manager.ts';
import type { LoadedModel } from '../resource/ollama-control.ts';
import { resolveModel } from '../resource/selector.ts';
import { runtimeFor as defaultRuntimeFor } from '../runtime/registry.ts';
import type { Runtime } from '../runtime/runtime.ts';
import { recordModelSelect } from '../telemetry/spans.ts';

export type SelectHookDeps = {
  registry: ModelDeclaration[];
  ensureReady: (d: ModelDeclaration, o?: EnsureOpts) => Promise<number>;
  pinned: string[];
  capture: ResourceCapture;
  listLoaded?: () => Promise<LoadedModel[]>;
  /** Fired once after resolveModel succeeds, with the chosen ctx. */
  notify?: (decl: ModelDeclaration, numCtx: number) => void | Promise<void>;
  /** Resolve a runtime by kind; defaults to the real runtime registry. Overridable in tests. */
  runtimeFor?: (kind: RuntimeKind) => Runtime;
  /** Fired when a declared non-Ollama runtime is unreachable and selection degrades to Ollama. */
  log?: (message: string) => void;
};

/**
 * Build the onBeforeDelegate hook: resolve the agent's requirement live, bind the
 * chosen model + numCtx, and on a genuine no-fit record it in `capture` and abort
 * the delegation (rather than letting the AI SDK swallow the error).
 */
export function createSelectHook(deps: SelectHookDeps): BeforeDelegate {
  const resolveRuntime = deps.runtimeFor ?? defaultRuntimeFor;
  return async (agent: Agent) => {
    if (!agent.modelReq) return {};
    try {
      const { decl, numCtx } = await resolveModel(
        agent.modelReq,
        deps.registry,
        {
          ensureReady: deps.ensureReady,
          listLoaded: deps.listLoaded,
        },
        { pinned: deps.pinned },
      );
      await deps.notify?.(decl, numCtx);
      let rt = resolveRuntime(decl.runtime);
      let effectiveDecl = decl;
      let degraded = false;
      // Opt-in + degrade: a non-Ollama runtime (e.g. MLX) is only used when
      // actually reachable. Ollama is the always-on default, so it never
      // needs the probe on its own happy path.
      if (decl.runtime !== RuntimeKind.Ollama && !(await rt.isAvailable())) {
        deps.log?.(
          `Runtime "${decl.runtime}" is unreachable for model "${decl.model}"; falling back to Ollama.`,
        );
        rt = resolveRuntime(RuntimeKind.Ollama);
        degraded = true;
        // The declared model id belongs to the original runtime (e.g. an MLX/HF
        // repo id) and is not resolvable by Ollama. Use the declared Ollama
        // fallback tag when the decl names one; otherwise the honest fallback
        // is to reuse `decl.model` as-is (already logged above).
        effectiveDecl = { ...decl, model: decl.fallbackModel ?? decl.model };
      }
      recordModelSelect({
        modelId: effectiveDecl.model,
        provider: decl.runtime, // telemetry field name is legacy; value is the *declared* inference runtime (gen_ai.system).
        numCtx,
        paramsBillions: decl.footprint.approxParamsBillions,
        runtime: rt.kind,
        degraded,
      });
      const model = rt.createModel(effectiveDecl);
      return {
        model,
        numCtx: rt.kind === RuntimeKind.Ollama ? numCtx : undefined,
      };
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
