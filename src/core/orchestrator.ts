import type { LanguageModel, ToolSet } from 'ai';
import type { MediaStore } from '../media/store.ts';
import type { DegradationLedger } from '../reliability/ledger.ts';
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
import { type EventSink, noopEventSink } from './events.ts';
import { withRootDelegationContext } from './guardrails.ts';
import type { ResourceCapture } from './resource-capture.ts';

export type OrchestratorResult =
  | { kind: 'answer'; text: string }
  | { kind: 'gap'; missingCapability: string; message: string }
  | { kind: 'resource'; message: string };

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
  /** Optional degradation ledger; forwarded to each delegate tool so a
   *  dropped sub-agent (or a tripped circuit) is recorded. */
  ledger?: DegradationLedger;
  /** Optional run-scoped media store; forwarded to each delegate tool so a
   *  specialist's `runDefinedAgent` can resolve `[img:h]`/`[video:h]`
   *  markers in its task (media-by-reference — the orchestrator itself
   *  never rehydrates attachments). */
  mediaStore?: MediaStore;
  /** Optional status-event sink; forwarded to each delegate tool so a future
   *  server can observe delegation without the engine importing wire types. */
  events?: EventSink;
}): Agent {
  const tools: ToolSet = { [CAPABILITY_GAP_TOOL]: capabilityGapTool };
  for (const agent of opts.agents) {
    tools[delegateToolName(agent)] = asDelegateTool(
      agent,
      opts.onBeforeDelegate,
      opts.ledger,
      opts.mediaStore,
      opts.events ?? noopEventSink,
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

/** Run the orchestrator; return the answer, a capability gap, or a resource failure. */
export async function runOrchestrator(
  orchestrator: Agent,
  task: string,
  numCtx?: number,
  capture?: ResourceCapture,
  signal?: AbortSignal,
): Promise<OrchestratorResult> {
  let text: string;
  let steps: Parameters<typeof findCapabilityGap>[0];

  try {
    const result = await withRootDelegationContext(numCtx, () =>
      runDefinedAgent(orchestrator, task, numCtx, undefined, signal),
    );
    text = result.text;
    steps = result.steps;
  } catch (err) {
    // A genuine resource failure during delegation takes precedence over anything else.
    if (capture?.error) {
      return { kind: 'resource', message: capture.error.message };
    }
    if (err instanceof MaxStepsError) {
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

  if (capture?.error) {
    return { kind: 'resource', message: capture.error.message };
  }

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
