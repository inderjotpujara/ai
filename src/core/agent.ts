import { generateText, stepCountIs, type LanguageModel, type ToolSet } from 'ai';
import type { ProviderOptions } from '@ai-sdk/provider-utils';

const DEFAULT_MAX_STEPS = 10;

export type RunAgentInput = {
  model: LanguageModel;
  systemPrompt: string;
  prompt: string;
  tools: ToolSet;
  maxSteps?: number;
  temperature?: number;
  providerOptions?: ProviderOptions;
};

/** Run one agent turn: model + tools loop, bounded by a step guard. */
export async function runAgent(
  input: RunAgentInput,
): Promise<{ text: string }> {
  const { text } = await generateText({
    model: input.model,
    system: input.systemPrompt,
    prompt: input.prompt,
    tools: input.tools,
    temperature: input.temperature,
    providerOptions: input.providerOptions,
    stopWhen: stepCountIs(input.maxSteps ?? DEFAULT_MAX_STEPS),
  });
  return { text };
}
