const OUTPUT_RATE = 16000;

/**
 * Streaming linear-interpolation resampler from `inputRate` down to the
 * fixed 16 kHz `VoiceFrames` rate. Carries continuous state across
 * `process()` calls so an AudioWorklet render-quantum boundary (128 frames,
 * arbitrary with respect to the resample ratio — Web Audio spec) never
 * drops or duplicates a sample (spec §7.1). Mirrors `src/voice/capture.ts`'s
 * `carryPcmChunk` leftover-byte-carry pattern, adapted from byte-alignment
 * to continuous-time resampling.
 *
 * Output samples sit on the continuous grid `p_k = k * ratio` (in GLOBAL
 * input-sample-index units, k = 0, 1, 2, ...). `nextP` is the next `p_k` to
 * compute; `globalOffsetSoFar` is the global index of the first sample in
 * the quantum about to be processed; `prevLast` is the previous quantum's
 * final sample, needed only when an output position's lower interpolation
 * index falls exactly on that boundary sample (`idxLow === -1`). This makes
 * the function's output PROVABLY invariant to how the same total input is
 * chunked: re-chunking only changes which call computes which output
 * sample, never the sequence of floating-point operations performed.
 *
 * Lives in its own zero-dependency module so it can be bundled into BOTH the
 * main app (`audio-capture.ts`, which re-exports it) AND the AudioWorklet
 * chunk (`downsample-worklet.ts`, loaded via `?worker&url`) without the
 * worklet build dragging in browser-only code or forming a circular worker
 * reference through `audio-capture.ts`. One source of truth for the math —
 * `audio-capture.test.ts` exercises it via the re-export.
 */
export function createDownsampler(inputRate: number): {
  process(quantum: Float32Array): Float32Array;
  flush(): Float32Array;
} {
  const ratio = inputRate / OUTPUT_RATE;
  let nextP = 0;
  let globalOffsetSoFar = 0;
  let prevLast: number | undefined;

  function process(quantum: Float32Array): Float32Array {
    const n = quantum.length;
    if (n === 0) return new Float32Array(0);
    const out: number[] = [];
    const upperBound = globalOffsetSoFar + n - 1;
    while (nextP < upperBound) {
      const floorP = Math.floor(nextP);
      const frac = nextP - floorP;
      const idxLow = floorP - globalOffsetSoFar;
      // Invariant (proven in the doc comment above): idxLow is always >= -1
      // here, and idxLow+1 is always a valid index into `quantum` — so
      // these reads are safe despite `noUncheckedIndexedAccess`.
      const s0 =
        idxLow === -1 ? (prevLast as number) : (quantum[idxLow] as number);
      const s1 =
        idxLow === -1
          ? (quantum[0] as number)
          : (quantum[idxLow + 1] as number);
      out.push(s0 + (s1 - s0) * frac);
      nextP += ratio;
    }
    globalOffsetSoFar += n;
    prevLast = quantum[n - 1];
    return new Float32Array(out);
  }

  function flush(): Float32Array {
    // No output sample is ever withheld beyond what `process()` already
    // emitted: a point is only produced once BOTH its bracketing input
    // samples are known, so there is nothing left to synthesize at stop
    // without extrapolating audio that was never captured. Reset state so
    // the instance is safe to reuse for a fresh capture session.
    nextP = 0;
    globalOffsetSoFar = 0;
    prevLast = undefined;
    return new Float32Array(0);
  }

  return { process, flush };
}
