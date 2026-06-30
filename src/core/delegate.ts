import type { LanguageModel } from 'ai';
import { tool } from 'ai';
import { z } from 'zod';
import { withDelegationSpan } from '../telemetry/spans.ts';
import { type Agent, runDefinedAgent } from './agent-def.ts';

/** The orchestrator-facing tool name for delegating to an agent. */
export function delegateToolName(agent: Agent): string {
  return `delegate_to_${agent.name}`;
}

/**
 * A hook run just before a delegated agent executes. May return a chosen context
 * size, a model to bind for this call, and/or an `abort` message that skips the
 * delegation entirely (returned to the orchestrator as a soft tool error).
 */
export type BeforeDelegate = (
  agent: Agent,
  // biome-ignore lint/suspicious/noConfusingVoidType: void is intentional — hooks may return nothing.
) => Promise<{ numCtx?: number; model?: LanguageModel; abort?: string } | void>;

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
    execute: async ({ task }) =>
      withDelegationSpan(agent.name, async () => {
        try {
          const pre = onBeforeDelegate
            ? await onBeforeDelegate(agent)
            : undefined;
          if (pre?.abort) {
            return { error: pre.abort };
          }
          const { text } = await runDefinedAgent(
            agent,
            task,
            pre?.numCtx,
            pre?.model,
          );
          return { text };
        } catch (cause) {
          return {
            error: `Agent ${agent.name} failed: ${(cause as Error).message}`,
          };
        }
      }),
  });
}
