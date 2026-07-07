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
import { MediaKind } from '../types.ts';
import type { GenOpts, GenStrategy } from './adapter.ts';
import { runGenJob } from './adapter.ts';
import { kokoroStrategy, resolveVoiceModel } from './audio-mlx.ts';
import type { GenModelCandidate } from './catalog.ts';
import { GenEngine } from './catalog.ts';
import { wanComfyStrategy } from './comfy-lane.ts';
import { mfluxStrategy } from './image-mflux.ts';
import { selectGenModel } from './select.ts';
import { ltxStrategy } from './video-mlx.ts';

const STRATEGY_FOR_ENGINE: Record<GenEngine, GenStrategy> = {
  [GenEngine.Mflux]: mfluxStrategy,
  [GenEngine.MlxAudio]: kokoroStrategy,
  [GenEngine.MlxVideo]: ltxStrategy,
  [GenEngine.ComfyWan]: wanComfyStrategy,
};

/** The same-kind other-engine video strategy, used as the runGenJob fallback
 *  so the one-shot↔server degrade is reachable. */
function videoFallbackFor(primary: GenStrategy): GenStrategy {
  return primary === ltxStrategy ? wanComfyStrategy : ltxStrategy;
}

/** Builds the media-generation tools (`generate_image`, `generate_speech`,
 *  `generate_video`) bound to a `MediaStore`, so a live agent can actually
 *  produce a file rather than just describing one. Each tool fit-selects a
 *  model first (`selectGenModel`, largest-that-fits by footprint against the
 *  live hardware budget) and returns a graceful message — never a crash —
 *  when nothing fits, AND when the fit-selected engine itself fails (missing
 *  CLI, unreachable server, any `job.result()` rejection) — every failure
 *  mode degrades to a message, never an uncaught rejection. The video tool
 *  additionally wires a same-kind other-engine `fallback` into `runGenJob`
 *  so the one-shot↔server degrade is reachable. Each tool returns a text
 *  summary including the output file's URI — never raw bytes.
 *
 *  `askCloneConsent` is injectable so tests (and non-TTY hosts) can script
 *  the voice-clone consent answer instead of hitting a real stdin prompt; it
 *  defaults to a real TTY yes/no prompt (`defaultCloneConsentAsk`). This gate
 *  is orthogonal to the content-policy switch — it only fires for
 *  voice-cloning models (see `requiresCloneConsent`), never for Kokoro.
 *
 *  `selectModel` is a test seam overriding the fit selector; it defaults to
 *  the real `selectGenModel`. */
export function createGenerateTools(
  store: MediaStore,
  deps?: {
    spawn?: SpawnFn;
    askCloneConsent?: (question: string) => Promise<boolean>;
    /** Test seam: override the fit selector. */
    selectModel?: (kind: MediaKind) => Promise<GenModelCandidate | undefined>;
  },
): ToolSet {
  const select =
    deps?.selectModel ?? ((kind: MediaKind) => selectGenModel(kind));

  const generate_image = tool({
    description: 'Generates an image from a text prompt and saves it to disk.',
    inputSchema: z.object({
      prompt: z
        .string()
        .describe('A clear, detailed description of the image to generate'),
    }),
    execute: async ({ prompt }) => {
      const candidate = await select(MediaKind.Image);
      if (!candidate) {
        return 'No image-generation model fits this machine — set AGENT_IMAGE_MODEL or free up memory. Image was not generated.';
      }
      const strategy = STRATEGY_FOR_ENGINE[candidate.engine];
      const opts: GenOpts = { model: candidate.repo };
      const job = runGenJob(strategy, prompt, store, 'image/png', opts, deps);
      try {
        const fh = await job.result();
        return `Generated image: ${fh.uri}`;
      } catch (err) {
        return `Image generation failed (${err instanceof Error ? err.message : String(err)}). Image was not generated.`;
      }
    },
  });

  const generate_speech = tool({
    description: 'Generates spoken audio from text and saves it to disk.',
    inputSchema: z.object({ prompt: z.string().describe('The text to speak') }),
    execute: async ({ prompt }) => {
      const candidate = await select(MediaKind.Audio);
      if (!candidate) {
        return 'No speech-generation model fits this machine — set AGENT_VOICE_MODEL or free up memory. Speech was not generated.';
      }
      const opts: GenOpts = { model: candidate.repo };
      const model = resolveVoiceModel(opts);
      if (requiresCloneConsent(model)) {
        const ask = deps?.askCloneConsent ?? defaultCloneConsentAsk();
        const consented = await affirmCloneConsent({ ask });
        if (!consented) {
          return `Voice-clone consent declined for model "${model}" — speech was not generated.`;
        }
      }
      const strategy = STRATEGY_FOR_ENGINE[candidate.engine];
      const job = runGenJob(strategy, prompt, store, 'audio/wav', opts, deps);
      try {
        const fh = await job.result();
        return `Generated speech: ${fh.uri}`;
      } catch (err) {
        return `Speech generation failed (${err instanceof Error ? err.message : String(err)}). Speech was not generated.`;
      }
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
      const candidate = await select(MediaKind.Video);
      if (!candidate) {
        return 'No video-generation model fits this machine — set AGENT_VIDEO_MODEL or use a higher-memory/disk box. Video was not generated.';
      }
      const strategy = STRATEGY_FOR_ENGINE[candidate.engine];
      const opts: GenOpts = { model: candidate.repo };
      const job = runGenJob(strategy, prompt, store, 'video/mp4', opts, {
        ...deps,
        fallback: videoFallbackFor(strategy),
        serverReachable: () => true, // sync probe seam; async reachability below
      });
      try {
        const fh = await job.result();
        return `Generated video: ${fh.uri}`;
      } catch (err) {
        return `Video generation failed (${err instanceof Error ? err.message : String(err)}). Video was not generated.`;
      }
    },
  });

  return { generate_image, generate_speech, generate_video };
}
