/** Re-exported from contracts (Slice 30b Phase 7, D5) — the browser voice
 *  code needs the IDENTICAL shape and `src/voice/` is Node-only, so
 *  `src/contracts/voice.ts` is now the single source of truth; this file
 *  re-exports rather than redefines. (Imported, not just re-exported, so
 *  `Transcriber` below can still reference it locally.) */
import type { VoiceFrames } from '../contracts/voice.ts';

/** Re-exported from contracts (Slice 30b Phase 7, D5) — see the VoiceFrames
 *  re-export above for the rationale. */
export { CaptureSource } from '../contracts/enums.ts';
export type { VoiceFrames };

export enum VoiceOutcome {
  Ok = 'ok',
  Empty = 'empty',
  Failed = 'failed',
  Timeout = 'timeout',
}

/** Typed voice error; `hint` is a user-actionable next step (e.g. mic permission). */
export class VoiceError extends Error {
  constructor(
    message: string,
    readonly hint?: string,
  ) {
    super(message);
    this.name = 'VoiceError';
  }
}

export type VoiceConfig = {
  /** Absolute path to the moonshine model directory. */
  modelDir: string;
  /** ffmpeg binary (resolved). */
  ffmpeg: string;
  /** Wall-clock cap for a single capture/transcribe op, ms. */
  timeoutMs: number;
};

/** Turns a recorded utterance into text. Impl is in-process or subprocess. */
export type Transcriber = {
  transcribe(frames: VoiceFrames): Promise<string>;
  close(): Promise<void>;
};
