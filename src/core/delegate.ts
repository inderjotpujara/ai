import { tool } from 'ai';
import { z } from 'zod';
import { type Agent, runDefinedAgent } from './agent-def.ts';

/** The orchestrator-facing tool name for delegating to an agent. */
export function delegateToolName(agent: Agent): string {
  return `delegate_to_${agent.name}`;
}

/** A hook run just before a delegated agent executes; may return a chosen context size. */
export type BeforeDelegate = (
  agent: Agent,
) => Promise<{ numCtx?: number } | void>;

/**
 * Wrap an agent as a tool the orchestrator can call. On failure it RETURNS a
 * structured error (so the orchestrator model can react) rather than throwing.
 */
export function asDelegateTool(
  agent: Agent,
  onBeforeDelegate?: BeforeDelegate,
) {
  return tool({
    description: agent.description,
    inputSchema: z.object({
      task: z.string().describe('The task for this agent'),
    }),
    execute: async ({ task }) => {
      try {
        const pre = onBeforeDelegate
          ? await onBeforeDelegate(agent)
          : undefined;
        const { text } = await runDefinedAgent(agent, task, pre?.numCtx);
        return { text };
      } catch (cause) {
        return {
          error: `Agent ${agent.name} failed: ${(cause as Error).message}`,
        };
      }
    },
  });
}
