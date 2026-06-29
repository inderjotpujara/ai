import type { ProviderOptions } from '@ai-sdk/provider-utils';
import {
  generateText,
  type LanguageModel,
  stepCountIs,
  type ToolSet,
} from 'ai';
import { MaxStepsError } from './errors.ts';

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

/** Run one agent turn: model + tools loop, bounded by a step guard. Returns text + steps. */
export async function runAgent(input: RunAgentInput): Promise<{
  text: string;
  steps: Awaited<ReturnType<typeof generateText>>['steps'];
}> {
  const result = await generateText({
    model: input.model,
    system: input.systemPrompt,
    prompt: input.prompt,
    tools: input.tools,
    temperature: input.temperature,
    providerOptions: input.providerOptions,
    stopWhen: stepCountIs(input.maxSteps ?? DEFAULT_MAX_STEPS),
  });
  const { text, finishReason, steps } = result;
  if (text.trim() === '' && finishReason !== 'stop') {
    throw new MaxStepsError(
      `Agent exhausted step ceiling (${steps.length} steps) without producing a final answer.`,
      steps,
    );
  }
  return { text, steps };
}
