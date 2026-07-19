import type { ProviderOptions } from '@ai-sdk/provider-utils';
import {
  generateText,
  type LanguageModel,
  type ModelMessage,
  isStepCount,
  streamText,
  type ToolSet,
} from 'ai';
import type { MediaFilePart } from '../media/types.ts';
import { runTimeoutMs } from '../reliability/config.ts';
import { withWallClock } from '../reliability/timeout.ts';
import { recordIoEnabled } from '../telemetry/provider.ts';
import { MaxStepsError } from './errors.ts';

const DEFAULT_MAX_STEPS = 10;

/**
 * Sink for the UI-message stream produced by the `streamText` path. Typed as
 * the web-standard `ReadableStream` (not an AI-SDK type) so this engine
 * boundary stays AI-SDK-type-free for downstream consumers; the AI-SDK
 * `toUIMessageStream()` return value is assignable to it.
 */
export type StreamSink = (uiStream: ReadableStream) => void;

export type RunAgentInput = {
  model: LanguageModel;
  systemPrompt: string;
  prompt: string;
  tools: ToolSet;
  attachments?: MediaFilePart[];
  maxSteps?: number;
  temperature?: number;
  providerOptions?: ProviderOptions;
  functionId?: string;
  abortSignal?: AbortSignal;
  /** When set, `runAgent` streams via `streamText` instead of `generateText`
   *  and hands the UI-message stream to this sink (before draining it inside
   *  the wall-clock timeout). Omitted -> batch `generateText` (default). */
  stream?: StreamSink;
};

/**
 * Build the `prompt`/`messages` half of the `generateText` call.
 * No attachments -> plain text prompt. Attachments present -> a single user
 * message whose content is the text plus the file parts, so media reaches
 * the model.
 */
export function buildCallInput(
  prompt: string,
  attachments: MediaFilePart[] | undefined,
): { prompt: string } | { messages: ModelMessage[] } {
  if (!attachments || attachments.length === 0) {
    return { prompt };
  }
  return {
    messages: [
      {
        role: 'user',
        content: [{ type: 'text', text: prompt }, ...attachments],
      },
    ],
  };
}

/** Run one agent turn: model + tools loop, bounded by a step guard. Returns text + steps. */
export async function runAgent(input: RunAgentInput): Promise<{
  text: string;
  steps: Awaited<ReturnType<typeof generateText>>['steps'];
}> {
  if (input.stream) {
    const { text, finishReason, steps } = await withWallClock(
      runTimeoutMs(),
      async (signal) => {
        const result = streamText({
          model: input.model,
          instructions: input.systemPrompt,
          ...buildCallInput(input.prompt, input.attachments),
          tools: input.tools,
          temperature: input.temperature,
          providerOptions: input.providerOptions,
          // See the comment on the `generateText` call below: `signal` is
          // withWallClock's combined signal (timeout + external abort) and
          // must be passed unconditionally.
          abortSignal: signal,
          stopWhen: isStepCount(input.maxSteps ?? DEFAULT_MAX_STEPS),
          telemetry: {
            isEnabled: true,
            functionId: input.functionId,
            recordInputs: recordIoEnabled(),
            recordOutputs: recordIoEnabled(),
          },
        });
        // Hand the caller the UI-message stream to merge BEFORE draining it.
        input.stream?.(result.toUIMessageStream());
        // MUST drain here: without consuming the stream, the AI SDK never
        // finishes the underlying generation promises and withWallClock
        // resolves almost immediately (elapsed ~1ms), defeating the
        // wall-clock timeout entirely (Spike A finding).
        await result.consumeStream();
        return {
          text: await result.text,
          finishReason: await result.finishReason,
          steps: await result.steps,
        };
      },
      input.abortSignal,
    );
    if (text.trim() === '' && finishReason !== 'stop') {
      throw new MaxStepsError(
        `Agent exhausted step ceiling (${steps.length} steps) without producing a final answer.`,
        steps,
      );
    }
    return { text, steps };
  }

  const result = await withWallClock(
    runTimeoutMs(),
    (signal) =>
      generateText({
        model: input.model,
        instructions: input.systemPrompt,
        ...buildCallInput(input.prompt, input.attachments),
        tools: input.tools,
        temperature: input.temperature,
        providerOptions: input.providerOptions,
        // `signal` is withWallClock's combined internal signal: it aborts on
        // the wall-clock TIMEOUT *and* when `input.abortSignal` (passed as the
        // external arg below) aborts. Pass it unconditionally — using
        // `input.abortSignal ?? signal` would hand generateText the external
        // signal whenever a caller supplies one, so the timeout would no
        // longer abort the model call (the exact background-leak this fixes).
        abortSignal: signal,
        stopWhen: isStepCount(input.maxSteps ?? DEFAULT_MAX_STEPS),
        telemetry: {
          isEnabled: true,
          functionId: input.functionId,
          recordInputs: recordIoEnabled(),
          recordOutputs: recordIoEnabled(),
        },
      }),
    input.abortSignal,
  );
  const { text, finishReason, steps } = result;
  if (text.trim() === '' && finishReason !== 'stop') {
    throw new MaxStepsError(
      `Agent exhausted step ceiling (${steps.length} steps) without producing a final answer.`,
      steps,
    );
  }
  return { text, steps };
}
