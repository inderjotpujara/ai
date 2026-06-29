import { tool } from 'ai';
import { z } from 'zod';
import { type Agent, runDefinedAgent } from './agent-def.ts';

/** The orchestrator-facing tool name for delegating to an agent. */
export function delegateToolName(agent: Agent): string {
  return `delegate_to_${agent.name}`;
}

/**
 * Wrap an agent as a tool the orchestrator can call. On failure it RETURNS a
 * structured error (so the orchestrator model can react) rather than throwing.
 */
export function asDelegateTool(agent: Agent) {
  return tool({
    description: agent.description,
    inputSchema: z.object({
      task: z.string().describe('The task for this agent'),
    }),
    execute: async ({ task }) => {
      try {
        const { text } = await runDefinedAgent(agent, task);
        return { text };
      } catch (cause) {
        return {
          error: `Agent ${agent.name} failed: ${(cause as Error).message}`,
        };
      }
    },
  });
}
