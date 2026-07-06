import type { ToolSet } from 'ai';
import { tool } from 'ai';
import { z } from 'zod';
import type { SpawnFn } from '../../runtime/process-supervisor.ts';
import {
  affirmCloneConsent,
  defaultCloneConsentAsk,
  requiresCloneConsent,
} from '../consent.ts';
import type { MediaStore } from '../store.ts';
import { runOneShotJob } from './adapter.ts';
import { kokoroStrategy, resolveVoiceModel } from './audio-mlx.ts';
import { mfluxStrategy } from './image-mflux.ts';
import { ltxStrategy } from './video-mlx.ts';

/** Builds the media-generation tools (`generate_image`, `generate_speech`,
 *  `generate_video`) bound to a `MediaStore`, so a live agent can actually
 *  produce a file rather than just describing one. Each tool returns a text
 *  summary including the output file's URI — never raw bytes.
 *
 *  `askCloneConsent` is injectable so tests (and non-TTY hosts) can script
 *  the voice-clone consent answer instead of hitting a real stdin prompt; it
 *  defaults to a real TTY yes/no prompt (`defaultCloneConsentAsk`). This gate
 *  is orthogonal to the content-policy switch — it only fires for
 *  voice-cloning models (see `requiresCloneConsent`), never for Kokoro. */
export function createGenerateTools(
  store: MediaStore,
  deps?: {
    spawn?: SpawnFn;
    askCloneConsent?: (question: string) => Promise<boolean>;
  },
): ToolSet {
  const generate_image = tool({
    description: 'Generates an image from a text prompt and saves it to disk.',
    inputSchema: z.object({
      prompt: z
        .string()
        .describe('A clear, detailed description of the image to generate'),
    }),
    execute: async ({ prompt }) => {
      const job = runOneShotJob(
        mfluxStrategy,
        prompt,
        store,
        'image/png',
        {},
        deps,
      );
      const fh = await job.result();
      return `Generated image: ${fh.uri}`;
    },
  });

  const generate_speech = tool({
    description: 'Generates spoken audio from text and saves it to disk.',
    inputSchema: z.object({
      prompt: z.string().describe('The text to speak'),
    }),
    execute: async ({ prompt }) => {
      const model = resolveVoiceModel({});
      if (requiresCloneConsent(model)) {
        const ask = deps?.askCloneConsent ?? defaultCloneConsentAsk();
        const consented = await affirmCloneConsent({ ask });
        if (!consented) {
          return `Voice-clone consent declined for model "${model}" — speech was not generated.`;
        }
      }
      const job = runOneShotJob(
        kokoroStrategy,
        prompt,
        store,
        'audio/wav',
        {},
        deps,
      );
      const fh = await job.result();
      return `Generated speech: ${fh.uri}`;
    },
  });

  // Video generation is long-running (can take minutes on-device); the tool
  // still awaits job.result() — progress is surfaced via telemetry, not by
  // returning early.
  const generate_video = tool({
    description:
      'Generates a short video from a text prompt and saves it to disk.',
    inputSchema: z.object({
      prompt: z
        .string()
        .describe('A clear, detailed description of the video to generate'),
    }),
    execute: async ({ prompt }) => {
      const job = runOneShotJob(
        ltxStrategy,
        prompt,
        store,
        'video/mp4',
        {},
        deps,
      );
      const fh = await job.result();
      return `Generated video: ${fh.uri}`;
    },
  });

  return { generate_image, generate_speech, generate_video };
}
