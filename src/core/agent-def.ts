import type { ProviderOptions } from '@ai-sdk/provider-utils';
import type { LanguageModel, ToolSet } from 'ai';
import { runAgent } from './agent.ts';
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

/** Run an agent definition against a task, optionally at a chosen context size and model. */
export function runDefinedAgent(
  agent: Agent,
  task: string,
  numCtx?: number,
  modelOverride?: LanguageModel,
): ReturnType<typeof runAgent> {
  return runAgent({
    model: modelOverride ?? agent.model,
    systemPrompt: agent.systemPrompt,
    prompt: task,
    tools: agent.tools,
    providerOptions: ollamaCtxOptions(numCtx),
    functionId: agent.name,
  });
}
