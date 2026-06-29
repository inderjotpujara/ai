import type { LanguageModel, ToolSet } from 'ai';
import { type Agent, runDefinedAgent } from './agent-def.ts';
import {
  CAPABILITY_GAP_TOOL,
  capabilityGapTool,
  findCapabilityGap,
} from './capability-gap.ts';
import {
  asDelegateTool,
  type BeforeDelegate,
  delegateToolName,
} from './delegate.ts';
import { MaxStepsError } from './errors.ts';

export type OrchestratorResult =
  | { kind: 'answer'; text: string }
  | { kind: 'gap'; missingCapability: string; message: string };

/** Build the orchestrator's system prompt: routing rules + the agent catalog. */
export function buildRoutingPrompt(
  basePrompt: string,
  agents: Agent[],
): string {
  const catalog = agents
    .map((a) => `- ${delegateToolName(a)}: ${a.description}`)
    .join('\n');
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
  onBeforeDelegate?: BeforeDelegate;
}): Agent {
  const tools: ToolSet = { [CAPABILITY_GAP_TOOL]: capabilityGapTool };
  for (const agent of opts.agents) {
    tools[delegateToolName(agent)] = asDelegateTool(
      agent,
      opts.onBeforeDelegate,
    );
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
  numCtx?: number,
): Promise<OrchestratorResult> {
  let text: string;
  let steps: Parameters<typeof findCapabilityGap>[0];

  try {
    const result = await runDefinedAgent(orchestrator, task, numCtx);
    text = result.text;
    steps = result.steps;
  } catch (err) {
    if (err instanceof MaxStepsError) {
      // Intentional: if report_capability_gap was called during the run, the
      // result is classified as kind:'gap' (gap takes precedence) regardless of
      // whether the agent produced any delegate output or final text.
      const gap = findCapabilityGap(
        err.steps as Parameters<typeof findCapabilityGap>[0],
      );
      if (gap) {
        return {
          kind: 'gap',
          missingCapability: gap.missingCapability,
          message: `I don't have a capability to handle this yet: ${gap.missingCapability}.`,
        };
      }
    }
    throw err;
  }

  // Intentional: if report_capability_gap was called in the run, the result is
  // classified as kind:'gap' (gap takes precedence) regardless of any delegate output.
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
