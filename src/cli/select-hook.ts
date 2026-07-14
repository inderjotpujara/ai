import { ModelLoadAction, StatusEventType } from '../contracts/index.ts';
import type { Agent } from '../core/agent-def.ts';
import type { BeforeDelegate } from '../core/delegate.ts';
import { ResourceError } from '../core/errors.ts';
import type { EventSink } from '../core/events.ts';
import type { ResourceCapture } from '../core/resource-capture.ts';
import { type ModelDeclaration, RuntimeKind } from '../core/types.ts';
import { uncensoredEnabled } from '../media/policy.ts';
import { type DegradationLedger, DegradeKind } from '../reliability/ledger.ts';
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
  /** Optional degradation ledger; records a ModelDegraded event on the runtime-degrade path. */
  ledger?: DegradationLedger;
  /** Optional status-event sink; emits ModelSelect/ModelLoad for the web live-rail. */
  events?: EventSink;
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
      const modelReq = {
        ...agent.modelReq,
        allowUncensored: agent.modelReq.allowUncensored ?? uncensoredEnabled(),
      };
      const { decl, numCtx } = await resolveModel(
        modelReq,
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
        deps.ledger?.record({
          kind: DegradeKind.ModelDegraded,
          subject: decl.model,
          reason: `runtime "${decl.runtime}" unreachable`,
          detail: `${decl.runtime}→ollama`,
          from: String(decl.runtime),
          to: 'ollama',
        });
        // The declared model id belongs to the original runtime (e.g. an MLX/HF
        // repo id) and is not resolvable by Ollama. Use the declared Ollama
        // fallback tag when the decl names one; otherwise the honest fallback
        // is to reuse `decl.model` as-is (already logged above).
        effectiveDecl = { ...decl, model: decl.fallbackModel ?? decl.model };
      }
      // Ollama already warms via `ensureReady` inside `resolveModel`. Managed
      // runtimes (MLX/LM Studio/llama.cpp) need an explicit warm at the
      // resolved context so the process is loaded with the right window
      // before the first call. Skipped when degraded to Ollama above.
      if (rt.kind !== RuntimeKind.Ollama) {
        await rt.control.warm(effectiveDecl.model, numCtx);
        deps.events?.({
          type: StatusEventType.ModelLoad,
          model: effectiveDecl.model,
          action: ModelLoadAction.Warm,
        });
      }
      recordModelSelect({
        modelId: effectiveDecl.model,
        provider: decl.runtime, // telemetry field name is legacy; value is the *declared* inference runtime (gen_ai.system).
        numCtx,
        paramsBillions: decl.footprint.approxParamsBillions,
        runtime: rt.kind,
        degraded,
      });
      deps.events?.({
        type: StatusEventType.ModelSelect,
        agent: agent.name,
        model: effectiveDecl.model,
        numCtx,
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
