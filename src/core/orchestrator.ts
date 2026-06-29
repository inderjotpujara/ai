import type { LanguageModel, ToolSet } from 'ai';
import { type Agent, runDefinedAgent } from './agent-def.ts';
import {
  CAPABILITY_GAP_TOOL,
  capabilityGapTool,
  findCapabilityGap,
} from './capability-gap.ts';
import { asDelegateTool, delegateToolName } from './delegate.ts';

export type OrchestratorResult =
  | { kind: 'answer'; text: string }
  | { kind: 'gap'; missingCapability: string; message: string };

/** Build the orchestrator's system prompt: routing rules + the agent catalog. */
export function buildRoutingPrompt(
  basePrompt: string,
  agents: Agent[],
): string {
  const catalog = agents.map((a) => `- ${a.name}: ${a.description}`).join('\n');
  return [
    basePrompt,
    '',
    'Available agents:',
    catalog,
    '',
    'Understand the user intent. If an agent fits, call its delegate_to_<name> tool with the task.',
    `If NO agent can handle it, call ${CAPABILITY_GAP_TOOL} with the missing capability.`,
    'Never attempt the task yourself.',
  ].join('\n');
}

/** Create the orchestrator: an Agent whose tools delegate to sub-agents (+ gap tool). */
export function createOrchestrator(opts: {
  name?: string;
  model: LanguageModel;
  systemPrompt: string;
  agents: Agent[];
}): Agent {
  const tools: ToolSet = { [CAPABILITY_GAP_TOOL]: capabilityGapTool };
  for (const agent of opts.agents) {
    tools[delegateToolName(agent)] = asDelegateTool(agent);
  }
  return {
    name: opts.name ?? 'orchestrator',
    description:
      'Routes tasks to specialized agents or reports a capability gap.',
    model: opts.model,
    systemPrompt: buildRoutingPrompt(opts.systemPrompt, opts.agents),
    tools,
  };
}

/** Run the orchestrator; return either the answer or a reported capability gap. */
export async function runOrchestrator(
  orchestrator: Agent,
  task: string,
): Promise<OrchestratorResult> {
  const { text, steps } = await runDefinedAgent(orchestrator, task);
  const gap = findCapabilityGap(steps);
  if (gap) {
    return {
      kind: 'gap',
      missingCapability: gap.missingCapability,
      message: `I don't have a capability to handle this yet: ${gap.missingCapability}.`,
    };
  }
  return { kind: 'answer', text };
}
