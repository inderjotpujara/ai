import { tool, type generateText } from 'ai';
import { z } from 'zod';

/** The tool the orchestrator calls when no registered agent can handle a task. */
export const CAPABILITY_GAP_TOOL = 'report_capability_gap';

export type CapabilityGap = { missingCapability: string };

type Steps = Awaited<ReturnType<typeof generateText>>['steps'];

/**
 * Tool the orchestrator calls when nothing fits. The FUTURE agent-builder hooks
 * in here. Detection happens from the run's steps (the call), not this result.
 */
export const capabilityGapTool = tool({
  description:
    'Call this ONLY when no available agent can handle the task. Describe the missing capability.',
  inputSchema: z.object({
    missingCapability: z
      .string()
      .describe('The capability that is missing, in plain words'),
  }),
  execute: async () => ({ reported: true }),
});

/** Find a reported capability gap in a run's steps, if any. */
export function findCapabilityGap(steps: Steps): CapabilityGap | undefined {
  for (const step of steps) {
    for (const call of step.toolCalls) {
      if (call.toolName === CAPABILITY_GAP_TOOL) {
        return call.input as CapabilityGap;
      }
    }
  }
  return undefined;
}
