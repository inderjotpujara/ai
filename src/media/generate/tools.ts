import type { ToolSet } from 'ai';
import { tool } from 'ai';
import { z } from 'zod';
import type { SpawnFn } from '../../runtime/process-supervisor.ts';
import type { MediaStore } from '../store.ts';
import { runOneShotJob } from './adapter.ts';
import { kokoroStrategy } from './audio-mlx.ts';
import { mfluxStrategy } from './image-mflux.ts';

/** Builds the media-generation tools (`generate_image`, `generate_speech`)
 *  bound to a `MediaStore`, so a live agent can actually produce a file
 *  rather than just describing one. Each tool returns a text summary
 *  including the output file's URI — never raw bytes. */
export function createGenerateTools(
  store: MediaStore,
  deps?: { spawn?: SpawnFn },
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

  return { generate_image, generate_speech };
}
