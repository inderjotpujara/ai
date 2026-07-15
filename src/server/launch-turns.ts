import { AGENTS, agentNames } from '../../agents/index.ts';
import { runCrewCli } from '../cli/crew.ts';
import { runFlow } from '../cli/flow.ts';
import { createSelectionRuntime } from '../cli/select-runtime.ts';
import { withMcpRun } from '../cli/with-mcp-run.ts';
import type { Agent } from '../core/agent-def.ts';
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
