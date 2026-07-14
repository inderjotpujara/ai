import type { ProviderOptions } from '@ai-sdk/provider-utils';
import type { LanguageModel, ToolSet } from 'ai';
import { resolveAttachments } from '../media/resolve.ts';
import type { MediaStore } from '../media/store.ts';
import { runAgent, type StreamSink } from './agent.ts';
import type { ModelDeclaration, ModelRequirement } from './types.ts';

/** A reusable agent: its own model + system prompt + tools, plus a routing description. */
export type Agent = {
  name: string; // stable id used in delegate tool names, e.g. 'file_qa'
  description: string; // capability description the orchestrator routes on
  model: LanguageModel;
  systemPrompt: string;
  tools: ToolSet;
  /** Declaration of the agent's model, for the resource manager (optional). */
  modelDecl?: ModelDeclaration;
  /** Capability requirement resolved LIVE by the selector via onBeforeDelegate. */
  modelReq?: ModelRequirement;
};

/** Build provider options that set Ollama's context window for this call. */
export function ollamaCtxOptions(numCtx?: number): ProviderOptions | undefined {
  return numCtx === undefined
    ? undefined
    : { ollama: { options: { num_ctx: numCtx } } };
}

/** Run an agent definition against a task, optionally at a chosen context
 *  size and model, and optionally bounded by an AbortSignal (the verify
 *  gate's dry-run/golden-eval calls pass `AbortSignal.timeout(dryRunMs())`
 *  so a hung model call aborts instead of hanging the build). When a
 *  `mediaStore` is supplied, media handles referenced in `task` (e.g.
 *  `[img:img_1]`) are rehydrated into attachments so images/frames reach
 *  the model — the router→specialist boundary stays a plain string
 *  (media-by-reference) while the specialist does the rehydration. */
export async function runDefinedAgent(
  agent: Agent,
  task: string,
  numCtx?: number,
  modelOverride?: LanguageModel,
  abortSignal?: AbortSignal,
  mediaStore?: MediaStore,
  deps?: { runAgentImpl?: typeof runAgent; stream?: StreamSink },
): ReturnType<typeof runAgent> {
  const runAgentImpl = deps?.runAgentImpl ?? runAgent;
  const attachments = mediaStore
    ? await resolveAttachments(task, mediaStore)
    : undefined;
  return runAgentImpl({
    model: modelOverride ?? agent.model,
    systemPrompt: agent.systemPrompt,
    prompt: task,
    tools: agent.tools,
    attachments,
    providerOptions: ollamaCtxOptions(numCtx),
    functionId: agent.name,
    abortSignal,
    stream: deps?.stream,
  });
}
