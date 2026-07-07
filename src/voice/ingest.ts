import type { IngestFlags } from '../media/ingest.ts';
import { type DegradationLedger, DegradeKind } from '../reliability/ledger.ts';
import { type Transcriber, VoiceError, type VoiceFrames } from './types.ts';

export type VoiceIngestDeps = {
  captureFile: (path: string) => Promise<VoiceFrames>;
  captureMic: () => Promise<VoiceFrames>;
  transcriber: Transcriber;
  ledger?: DegradationLedger;
};

export type VoiceIngestResult = { prompt: string; warnings: string[] };

/** Captures + transcribes voice input (file paths via `--voice-in`, then a
 *  single mic capture via `--voice`) and splices the transcript(s) into the
 *  prompt. Never throws: any capture/transcribe failure becomes a warning +
 *  a degrade-ledger entry, and that source is simply skipped. */
export async function ingestVoice(
  rawPrompt: string,
  flags: IngestFlags,
  deps: VoiceIngestDeps,
): Promise<VoiceIngestResult> {
  const warnings: string[] = [];
  const transcripts: string[] = [];

  const collect = async (get: () => Promise<VoiceFrames>) => {
    try {
      const frames = await get();
      const text = (await deps.transcriber.transcribe(frames)).trim();
      if (text) {
        transcripts.push(text);
      } else {
        warnings.push('voice: no speech detected in the audio');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const hint =
        err instanceof VoiceError && err.hint ? ` — ${err.hint}` : '';
      warnings.push(`voice: ${message}${hint}`);
      deps.ledger?.record({
        kind: DegradeKind.ToolSkipped,
        subject: 'voice',
        reason: message,
      });
    }
  };

  for (const path of flags.voiceIn) await collect(() => deps.captureFile(path));
  if (flags.voice) await collect(() => deps.captureMic());

  const prompt = [rawPrompt, ...transcripts]
    .filter(Boolean)
    .join('\n\n')
    .trim();
  return { prompt, warnings };
}
