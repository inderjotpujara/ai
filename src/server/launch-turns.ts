import { AGENTS, agentNames } from '../../agents/index.ts';
import { buildAgent } from '../agent-builder/builder.ts';
import { makeRealBuilderDeps } from '../agent-builder/deps.ts';
import type { BuilderDeps } from '../agent-builder/types.ts';
import { runCrewCli } from '../cli/crew.ts';
import { runFlow } from '../cli/flow.ts';
import { createSelectionRuntime } from '../cli/select-runtime.ts';
import { withMcpRun } from '../cli/with-mcp-run.ts';
import { withRunTelemetry } from '../cli/with-run.ts';
import { BuilderKind } from '../contracts/enums.ts';
import type { Agent } from '../core/agent-def.ts';
import { buildCrewOrWorkflow } from '../crew-builder/builder.ts';
import { makeRealCrewBuilderDeps } from '../crew-builder/deps.ts';
import type { CrewBuilderDeps } from '../crew-builder/types.ts';
import type { RunBuilderTurn } from './builders/build.ts';
import {
  toBuildResultDto,
  toCrewBuildResultDto,
} from './builders/map-result.ts';
import type { RunCrewTurn } from './crews/run.ts';
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
