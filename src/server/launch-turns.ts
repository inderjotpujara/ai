import { generateText, type LanguageModel } from 'ai';
import { AGENTS, agentNames } from '../../agents/index.ts';
import { buildAgent } from '../agent-builder/builder.ts';
import {
  makeRealBuilderDeps,
  toJudgeCandidate,
} from '../agent-builder/deps.ts';
import type { BuilderDeps } from '../agent-builder/types.ts';
import { runCrewCli } from '../cli/crew.ts';
import { runFlow } from '../cli/flow.ts';
import { createSelectHook } from '../cli/select-hook.ts';
import { createSelectionRuntime } from '../cli/select-runtime.ts';
import { withMcpRun } from '../cli/with-mcp-run.ts';
import { withRunTelemetry } from '../cli/with-run.ts';
import { loadConfig } from '../config/schema.ts';
import { BuilderKind } from '../contracts/enums.ts';
import type { Agent } from '../core/agent-def.ts';
import { runGuardedAgent } from '../core/delegate.ts';
import type { OrchestratorResult } from '../core/orchestrator.ts';
import type { ResourceCapture } from '../core/resource-capture.ts';
import {
  Capability,
  type ModelDeclaration,
  PreferPolicy,
} from '../core/types.ts';
import { buildCrewOrWorkflow } from '../crew-builder/builder.ts';
import { makeRealCrewBuilderDeps } from '../crew-builder/deps.ts';
import type { CrewBuilderDeps } from '../crew-builder/types.ts';
import { buildRegistry } from '../discovery/build-registry.ts';
import { uncensoredEnabled } from '../media/policy.ts';
import { resolveDestDir } from '../provisioning/dest-dir.ts';
import { runModelPullBridge } from '../provisioning/pull-bridge.ts';
import { providerFor } from '../provisioning/registry.ts';
import { createJobStore } from '../queue/store.ts';
import { createModelManager } from '../resource/model-manager.ts';
import { listLoadedModels } from '../resource/ollama-control.ts';
import { resolveModel } from '../resource/selector.ts';
import { runtimeFor } from '../runtime/registry.ts';
import { type RunEvalDeps, runEval } from '../self-improve/executor.ts';
import { createEvalHistoryStore } from '../self-improve/history.ts';
import { ATTR, inSpan } from '../telemetry/spans.ts';
import { dryRunMs } from '../verified-build/config.ts';
import { loadGolden } from '../verified-build/golden.ts';
import { JudgeUnavailableError } from '../verified-build/judge.ts';
import { upsertEntry } from '../verified-build/manifest.ts';
import type { RunBuilderTurn } from './builders/build.ts';
import {
  toBuildResultDto,
  toCrewBuildResultDto,
} from './builders/map-result.ts';
import type { RunCrewTurn } from './crews/run.ts';
import {
  EvalMode,
  type RunAgentTurn,
  type RunEvalTurn,
} from './jobs/dispatch.ts';
import type { RunModelPullTurn } from './models/pull.ts';
import type { RunWorkflowTurn } from './workflows/run.ts';

/**
 * Real, non-test `RunCrewTurn`: one `withMcpRun` scope per launched run,
 * mounting MCP + live model selection + `runCrewCli` (the exact same path
 * `src/cli/crew.ts`'s `main()` uses). Kept thin and correct — like
 * `createRealRunChatTurn` (`src/server/chat/run-turn.ts`), this seam composes
 * real MCP mount + engine wiring, so it is covered by live-verify, not unit
 * tests (which would only mock the composition away).
 */
export function createRealRunCrewTurn(runsRoot: string): RunCrewTurn {
  return async ({ def, input, runId }) =>
    withMcpRun({ runsRoot, runId }, async ({ run, reg, ledger }) => {
      const selection = await createSelectionRuntime({ ledger });
      try {
        await runCrewCli({
          def,
          input,
          run,
          tools: reg.merged,
          onBeforeDelegate: selection.onBeforeDelegate,
          ledger,
        });
      } finally {
        await selection.close();
      }
    });
}

/**
 * Real, non-test `RunWorkflowTurn`: mirrors `createRealRunCrewTurn`, composing
 * `withMcpRun` + live model selection + the agent map (built exactly like
 * `src/cli/flow.ts`'s `main()`) + `runFlow`.
 */
export function createRealRunWorkflowTurn(runsRoot: string): RunWorkflowTurn {
  return async ({ def, input, runId }) =>
    withMcpRun({ runsRoot, runId }, async ({ run, reg, ledger }) => {
      const selection = await createSelectionRuntime({ ledger });
      try {
        const agents: Record<string, Agent> = {};
        for (const name of agentNames()) {
          const factory = AGENTS[name];
          if (!factory) throw new Error(`unknown agent: ${name}`);
          agents[name] = factory(reg.forAgent(name));
        }
        await runFlow({
          def,
          input,
          run,
          agents,
          tools: reg.merged,
          onBeforeDelegate: selection.onBeforeDelegate,
          ledger,
        });
      } finally {
        await selection.close();
      }
    });
}

/**
 * Real, non-test `RunAgentTurn` (§7.4 / capstone B3): run ONE registered
 * specialist agent to completion under its own `withMcpRun` scope, mirroring
 * `createRealRunWorkflowTurn`'s composition (MCP mount + live model selection)
 * but building just the single named agent instead of the full agent map + a
 * super-agent orchestrator. Dispatch invokes it for an A2A Chat skill bound to
 * an agent ref, so exposing that one skill exposes ONLY that agent — not every
 * local specialist + MCP + remotes.
 *
 * `runGuardedAgent` (the SAME guarded-delegation path the orchestrator/workflow
 * engine use) resolves the agent's model via the select-hook, wall-clock-bounds
 * it on the pool's signal, and RETURNS a structured `{ text } | { error }`
 * instead of throwing — mapped here onto the terminal `OrchestratorResult` the
 * A2A produce side projects to a task artifact (`answer`) or a `failed` task
 * (`resource`).
 */
export function createRealRunAgentTurn(runsRoot: string): RunAgentTurn {
  return async ({ ref, task, signal, runId }) =>
    withMcpRun({ runsRoot, runId }, async ({ reg, ledger }) => {
      const factory = AGENTS[ref];
      if (!factory) throw new Error(`unknown agent: ${ref}`);
      const agent = factory(reg.forAgent(ref));
      const selection = await createSelectionRuntime({ ledger });
      try {
        const outcome = await runGuardedAgent(
          agent,
          task,
          selection.onBeforeDelegate,
          signal,
          ledger,
        );
        return 'error' in outcome
          ? ({ kind: 'resource', message: outcome.error } as OrchestratorResult)
          : ({ kind: 'answer', text: outcome.text } as OrchestratorResult);
      } finally {
        await selection.close();
      }
    });
}

/**
 * Real, non-test `RunBuilderTurn`: reuses `withRunTelemetry` (NOT
 * `withMcpRun` — neither `buildAgent` nor `buildCrewOrWorkflow` mounts MCP
 * tools at dry-run time, D4/§4.2 item 1) so the run's spans (including
 * `agent.build`/`crew.build`, opened by `buildAgent`/`buildCrewOrWorkflow`
 * themselves) land in `runs/<id>/spans.jsonl`. Reuses the EXACT same
 * `makeRealBuilderDeps`/`makeRealCrewBuilderDeps` factories the CLI uses
 * (`src/cli/agent-builder.ts`/`crew-builder.ts`), only overriding
 * `confirm`/`log`/`verify.confirmReuse` with the SSE-bridged versions the
 * route built (Task 9/11) — everything else (model resolution, embedder,
 * judge wiring, fs paths) is identical to the CLI path.
 *
 * Span-once correctness (T11 cross-task item): `withRunTelemetry` owns the
 * ONE root span's open/close for this `runId` — it calls `createRun` once,
 * installs the run-scoped telemetry provider once, and its `finally` flushes
 * exactly once regardless of how `body` settles (resolve OR throw). The
 * `agent.build`/`crew.build` span nested inside it (opened by `buildAgent`/
 * `buildCrewOrWorkflow` via `withAgentBuildSpan`) is a plain try/finally
 * around the whole generate/consent/verify/commit body, so it closes on
 * every outcome — decline, invalid, abandoned, reused, failed-verification,
 * written, or an uncaught throw — with no early return bypassing it. This
 * turn is never given `req.signal` (it has no dependency on the HTTP
 * request/response lifecycle at all), so a client disconnect mid-stream
 * cannot tear the span down mid-stage either: the route's `execute` isn't
 * detached (see `handleBuilderBuild`'s doc comment), so the build simply
 * keeps running to completion server-side even if nobody is listening.
 */
export function createRealRunBuilderTurn(runsRoot: string): RunBuilderTurn {
  return ({ kind, need, autoYes, force, runId, confirm, confirmReuse, log }) =>
    withRunTelemetry({ runsRoot, runId }, async () => {
      if (kind === BuilderKind.Agent) {
        const { deps, cleanup } = await makeRealBuilderDeps({
          autoYes,
          force,
        });
        try {
          const overridden: BuilderDeps = {
            ...deps,
            confirm,
            log,
            verify: deps.verify && { ...deps.verify, confirmReuse },
          };
          return toBuildResultDto(await buildAgent(need, overridden));
        } finally {
          await cleanup();
        }
      }
      const { deps, cleanup } = await makeRealCrewBuilderDeps({
        autoYes,
        force,
      });
      try {
        const overridden: CrewBuilderDeps = {
          ...deps,
          confirm,
          log,
          verify: deps.verify && { ...deps.verify, confirmReuse },
        };
        return toCrewBuildResultDto(
          await buildCrewOrWorkflow(need, overridden),
        );
      } finally {
        await cleanup();
      }
    });
}

/**
 * Real, non-test `RunModelPullTurn`: `withRunTelemetry` (no MCP mount — a
 * pull mounts nothing) scopes `runModelPullBridge` (Task 15) with the REAL
 * `providerFor` (`src/provisioning/registry.ts`, the exact function
 * `runProvision`'s CLI path uses) and `resolveDestDir()`. No external cancel
 * this phase — an internally-owned `AbortController` is created per pull
 * (wiring a user-triggered cancel is a natural follow-on, not required here).
 */
/**
 * Real, non-test `RunEvalTurn` (Slice 32, Task 16): run a golden-set re-eval to
 * completion under its own run scope, then return `runEval`'s terminal
 * `OrchestratorResult`.
 *
 * Run scope: `withRunTelemetry` (NOT `withMcpRun`) — a re-eval REPLAYS an
 * artifact's persisted golden set against the freshly-resolved model, and the
 * baseline it diffs against was captured by the build-time golden eval, which
 * itself runs the agent WITHOUT MCP tools (D4). Replaying with MCP mounted would
 * grade against a different tool surface than the baseline, so the comparison
 * must stay MCP-free; skipping `withMcpRun` also avoids the `mcp.mount` precursor
 * root that `deriveRunKind` would otherwise classify ahead of `eval.reeval`.
 *
 * Root span: for `Artifact` mode `runArtifact` opens the `eval.reeval` root span
 * itself (`withEvalReevalSpan`); for `Sweep`/`AffectedByPull` (which only
 * enqueue per-artifact jobs and open no span of their own) this turn opens the
 * `eval.reeval` root so those coordination runs still classify as `RunKind.Eval`
 * — wrapping unconditionally would double-nest the Artifact-mode span, so the
 * wrap is applied only to the non-Artifact modes.
 *
 * Dep construction: everything heavy is built INSIDE the returned closure
 * (per-run), never at factory time — so `createRealRunEvalTurn(runsRoot)` at
 * daemon/server boot only allocates a closure and can never crash boot (the
 * Slice-31 lesson). The re-eval seams reuse the SAME primitives the builders
 * wire (`makeRealBuilderDeps`): one `createModelManager`, one `buildRegistry`,
 * `resolveModel` for drift-detection resolve, `createSelectHook` for the actual
 * agent run (the canonical resolve+warm+degrade path), `toJudgeCandidate` +
 * `generateText`-at-temperature-0 for the judge — no divergent second
 * model-resolution path. The history store + queue store both open the SAME
 * `jobs.db` (via `AGENT_QUEUE_PATH`, the directory `createJobStore` /
 * `createEvalHistoryStore` join `jobs.db` onto) the daemon's pool drains, so no
 * new path/DB is introduced.
 */
export function createRealRunEvalTurn(runsRoot: string): RunEvalTurn {
  return async ({ mode, ref, reason, runId, signal }) =>
    withRunTelemetry({ runsRoot, runId }, async () => {
      // Same directory the daemon/server's queue + trigger stores use, so the
      // eval-history table lives in the one jobs.db (never a second DB).
      const queuePath = String(loadConfig().values.AGENT_QUEUE_PATH);
      const history = createEvalHistoryStore({ path: queuePath });
      const jobStore = createJobStore({ path: queuePath }, {});
      const manager = createModelManager();

      // The live model engine is built lazily + memoized on first real use, so a
      // no-op pass (master switch off, or a sweep that finds nothing) never pays
      // for `buildRegistry` or touches a model.
      let engine:
        | {
            registry: ModelDeclaration[];
            selectHook: ReturnType<typeof createSelectHook>;
          }
        | undefined;
      const ensureEngine = async (): Promise<NonNullable<typeof engine>> => {
        if (!engine) {
          const registry = await buildRegistry();
          const capture: ResourceCapture = {};
          const selectHook = createSelectHook({
            registry,
            ensureReady: (d, o) => manager.ensureReady(d, o),
            listLoaded: () => listLoadedModels(),
            pinned: [],
            capture,
          });
          engine = { registry, selectHook };
        }
        return engine;
      };

      // Judge model cache, mirroring `makeRealBuilderDeps`' `judgeModelFor`:
      // resolve the id `selectJudge` picked to a LanguageModel via the SAME
      // manager, degrade to `JudgeUnavailableError` (skip behavioral eval) if it
      // vanished/can't load — never self-grade on the generator.
      const judgeModels = new Map<string, LanguageModel>();
      const judgeModelFor = async (id: string): Promise<LanguageModel> => {
        const cached = judgeModels.get(id);
        if (cached) return cached;
        const { registry } = await ensureEngine();
        const decl = registry.find((d) => d.model === id);
        if (!decl) throw new JudgeUnavailableError(id);
        try {
          await manager.ensureReady(decl);
          const lm = runtimeFor(decl.runtime).createModel(decl);
          judgeModels.set(id, lm);
          return lm;
        } catch (err) {
          if (err instanceof JudgeUnavailableError) throw err;
          throw new JudgeUnavailableError(id);
        }
      };

      const deps: RunEvalDeps = {
        // The reusable-artifact registry dirs the reuse/archive readers scan.
        registryDirs: ['agents', 'crews', 'workflows'],
        runsRoot,
        history,
        upsertEntry,
        jobStore,
        loadGolden,
        // Drift-detection resolve: the SAME requirement `makeRealBuilderDeps`
        // resolved against to capture the entry's `verifiedWith` baseline, so
        // `resolved.decl.model !== verifiedWith.model` compares like with like.
        resolve: async (need) => {
          const { registry } = await ensureEngine();
          return resolveModel(
            {
              role: need || 'agent builder',
              requires: [Capability.Tools],
              prefer: PreferPolicy.LargestThatFits,
              allowUncensored: uncensoredEnabled(),
            },
            registry,
            {
              ensureReady: (d, o) => manager.ensureReady(d, o),
              listLoaded: () => listLoadedModels(),
            },
          );
        },
        // Replay one golden case against the CURRENT model. Builds the REGISTERED
        // agent with an empty toolset (MCP-free, matching the build-time golden
        // eval) and runs it through the SAME guarded-delegation + `createSelectHook`
        // path the CLI/builder use — the hook resolves the agent's live model, so
        // the replay runs on "the model that would run today". A guarded failure
        // returns its message (the judge then fails the case) rather than throwing.
        // NOTE: crew/workflow artifacts are scanned for drift but `runCase`
        // currently reconstructs only agent refs (AGENTS); a crew/workflow golden
        // replay is a live-verify follow-on.
        runCase: async (refName, _model, input) => {
          const factory = AGENTS[refName];
          if (!factory) {
            throw new Error(`unknown agent for re-eval: ${refName}`);
          }
          const { selectHook } = await ensureEngine();
          const agent = factory({});
          const outcome = await runGuardedAgent(
            agent,
            input,
            selectHook,
            signal,
          );
          return 'error' in outcome ? outcome.error : outcome.text;
        },
        judgeCandidates: () => (engine?.registry ?? []).map(toJudgeCandidate),
        // Runs on the SELECTED judge model (never the generator), deterministically
        // (temperature 0) and bounded by `dryRunMs()` — identical to the builder
        // verify gate's judge, only the arg order differs (`(model, prompt)`).
        judge: async (judgeModelId, prompt) => {
          const r = await generateText({
            model: await judgeModelFor(judgeModelId),
            prompt,
            temperature: 0,
            abortSignal: AbortSignal.timeout(dryRunMs()),
          });
          return r.text.trim().toLowerCase().startsWith('yes');
        },
      };

      try {
        const exec = (): Promise<OrchestratorResult> =>
          runEval({ mode, ref, reason, signal }, deps);
        // Artifact mode opens its own `eval.reeval` root (withEvalReevalSpan);
        // only the enqueue-only modes need the turn to open one.
        return mode === EvalMode.Artifact
          ? await exec()
          : await inSpan('eval.reeval', async (span) => {
              span.setAttribute(ATTR.EVAL_MODE, mode);
              return exec();
            });
      } finally {
        history.close();
        jobStore.close();
        await manager.unloadAll();
      }
    });
}

export function createRealRunModelPull(runsRoot: string): RunModelPullTurn {
  return ({ runtime, provider, modelRef, runId }) =>
    withRunTelemetry({ runsRoot, runId }, () =>
      runModelPullBridge(
        { runtime, provider, modelRef, signal: new AbortController().signal },
        { providerFor, destDir: resolveDestDir() },
      ),
    );
}
