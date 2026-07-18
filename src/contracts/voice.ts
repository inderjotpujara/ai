/**
 * Raw audio ready for the STT engine: mono Float32 in [-1,1] at 16 kHz.
 * Lifted from `src/voice/types.ts` (Slice 30b Phase 7, D5) so the browser
 * voice code (`web/src/features/voice/`) and the CLI (`src/voice/`) share
 * ONE definition — `src/voice/types.ts` re-exports this rather than
 * redefining it.
 *
 * Deliberate exception to the "every contract is a zod schema" convention
 * every other file in this directory follows: `VoiceFrames` never crosses
 * an HTTP wire in this phase (audio never leaves the browser tab — there is
 * no server-side voice route), so there is no round-trip to validate and a
 * zod schema for a `Float32Array` field would add ceremony with nothing to
 * protect.
 */
export type VoiceFrames = {
  samples: Float32Array;
  sampleRate: 16000;
};
