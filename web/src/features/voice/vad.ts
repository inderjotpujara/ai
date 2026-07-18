import type { VoiceFrames } from '@contracts';

export type SegmenterOpts = {
  silenceMs: number;
  gated: boolean;
  frameMs: number;
};

export type Segmenter = {
  pushFrame(chunk: Float32Array, isSpeech: boolean): void;
  flush(): void;
  onSegment(cb: (frames: VoiceFrames) => void): () => void;
  reset(): void;
};

/**
 * Pure segmentation state machine (spec §7.1) — no real VAD model, no
 * timers. `isSpeech` is supplied by the caller (the worker's Silero pass
 * per pushed chunk, Task 12). Silence duration is tracked from each
 * chunk's *actual* sample-derived duration (`chunk.length / 16000 * 1000`
 * ms), falling back to `frameMs` only for a zero-length "heartbeat" chunk
 * (a VAD tick with no new audio attached) — this keeps the silence clock
 * correct regardless of the AudioWorklet's real chunk sizing, rather than
 * assuming every pushed chunk is exactly `frameMs` long.
 *
 * Two modes (`gated`):
 *  - `false` (hold-to-talk): every pushed frame belongs to the one
 *    segment, `isSpeech` is ignored entirely — the key/pointer gesture
 *    itself IS the segment boundary. Only `flush()` closes it, and it
 *    closes with everything buffered so far (no truncation of the
 *    release-boundary residual, §7.1 c). THIS task exercises this branch.
 *  - `true` (tap-to-toggle): `isSpeech` flips gate segment boundaries —
 *    a speech frame (re)starts/extends the current segment and resets the
 *    silence clock; a silent frame is buffered (kept, in case speech
 *    resumes) and accumulates against `silenceMs`; once sustained silence
 *    reaches `silenceMs`, the segment closes, with the trailing silent
 *    chunks trimmed back off the emitted audio (they are not speech).
 *    A tap-to-toggle session can close/reopen many segments in a row
 *    (§7.1 b — exactly one transcribe call per speech/silence cycle).
 *    Structure only in this task — behavior + tests owned by Task 11.
 */
export function createSegmenter(opts: SegmenterOpts): Segmenter {
  const { silenceMs, gated, frameMs } = opts;
  let buffer: Float32Array[] = [];
  let inSegment = false;
  let silentMsAccumulated = 0;
  // Count of consecutive trailing SILENT chunks since the last speech chunk
  // (Fix 5). Used to trim the closing silence by CHUNK COUNT rather than by
  // re-summing float durations backward: `silentMsAccumulated` is summed
  // forward while a backward re-sum is not bit-associative on variable-length
  // chunks (the real downsampler emits them), so a float `>=` tie could shift
  // the trim boundary by ±1 chunk. Counting the trailing silent chunks is
  // exact — they are precisely the chunks pushed after the last speech chunk.
  let trailingSilentCount = 0;
  const listeners = new Set<(frames: VoiceFrames) => void>();

  function chunkDurationMs(chunk: Float32Array): number {
    return chunk.length > 0 ? (chunk.length / 16000) * 1000 : frameMs;
  }

  function concat(chunks: Float32Array[]): Float32Array {
    const total = chunks.reduce((sum, c) => sum + c.length, 0);
    const out = new Float32Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  }

  function emit(): void {
    inSegment = false;
    silentMsAccumulated = 0;
    trailingSilentCount = 0;
    if (buffer.length === 0) return;
    const samples = concat(buffer);
    buffer = [];
    const frames: VoiceFrames = { samples, sampleRate: 16000 };
    for (const cb of listeners) cb(frames);
  }

  function closeSustainedSilence(): void {
    // Trim the trailing silent chunks themselves back off the emitted audio.
    // Trim by COUNT (`trailingSilentCount`, tracked as frames arrive) — the
    // trailing silent chunks are exactly the ones pushed after the last
    // speech chunk, so dropping that many lands the boundary precisely at the
    // end of the last speech-bearing chunk, with no float re-summation (Fix 5).
    buffer = buffer.slice(0, buffer.length - trailingSilentCount);
    emit();
  }

  function pushFrame(chunk: Float32Array, isSpeech: boolean): void {
    if (!gated) {
      // Non-gated (hold-to-talk) mode never reads `inSegment` — the
      // gesture itself is the segment boundary — so it's not written here.
      buffer.push(chunk);
      return;
    }
    if (isSpeech) {
      buffer.push(chunk);
      inSegment = true;
      silentMsAccumulated = 0;
      trailingSilentCount = 0; // speech resumed — the trailing-silence run resets
      return;
    }
    if (!inSegment) return; // silence before any speech started this cycle
    buffer.push(chunk);
    silentMsAccumulated += chunkDurationMs(chunk);
    trailingSilentCount += 1;
    if (silentMsAccumulated >= silenceMs) closeSustainedSilence();
  }

  function flush(): void {
    emit();
  }

  function reset(): void {
    buffer = [];
    inSegment = false;
    silentMsAccumulated = 0;
    trailingSilentCount = 0;
  }

  function onSegment(cb: (frames: VoiceFrames) => void): () => void {
    listeners.add(cb);
    return () => listeners.delete(cb);
  }

  return { pushFrame, flush, onSegment, reset };
}
