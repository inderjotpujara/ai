/** Raw audio ready for the STT engine: mono Float32 in [-1,1] at 16 kHz. */
export type VoiceFrames = {
  samples: Float32Array;
  sampleRate: 16000;
};

export enum CaptureSource {
  Mic = 'mic',
  File = 'file',
}

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
