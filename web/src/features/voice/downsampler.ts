const OUTPUT_RATE = 16000;

/** D7 anti-alias cutoff: "~7.5kHz" per the design decision — comfortably
 *  under the 16kHz output rate's 8kHz Nyquist, attenuating the content a
 *  bare 48k→16k (or similar) decimation would otherwise fold back into the
 *  audible band. Exported so `audio-capture.test.ts` can build an
 *  independent reference filter at the SAME cutoff, not a hardcoded
 *  duplicate the two could silently drift apart from. */
export const CUTOFF_HZ = 7500;

/**
 * Streaming linear-interpolation resampler from `inputRate` down to the
 * fixed 16 kHz `VoiceFrames` rate, preceded by a one-pole anti-alias
 * low-pass filter (D7). Carries continuous state across `process()` calls
 * so an AudioWorklet render-quantum boundary (128 frames, arbitrary with
 * respect to the resample ratio — Web Audio spec) never drops or
 * duplicates a sample (spec §7.1). Mirrors `src/voice/capture.ts`'s
 * `carryPcmChunk` leftover-byte-carry pattern, adapted from byte-alignment
 * to continuous-time resampling.
 *
 * Output samples sit on the continuous grid `p_k = k * ratio` (in GLOBAL
 * input-sample-index units, k = 0, 1, 2, ...). `nextP` is the next `p_k` to
 * compute; `globalOffsetSoFar` is the global index of the first sample in
 * the quantum about to be processed; `prevLast` is the previous quantum's
 * final FILTERED sample, needed only when an output position's lower
 * interpolation index falls exactly on that boundary sample (`idxLow ===
 * -1`). This makes the function's output PROVABLY invariant to how the same
 * total input is chunked: re-chunking only changes which call computes
 * which output sample, never the sequence of floating-point operations
 * performed — true of both the resample math AND the LPF's own recursive
 * carry state (`lastFiltered`), since a one-pole IIR filter's output only
 * ever depends on strict sequential sample order, never on where a chunk
 * boundary happens to fall.
 *
 * `lastFiltered` is WARM-STARTED (seeded to the very first raw sample
 * rather than 0) so a fresh capture session's filter has no artificial
 * startup ramp/click — this also makes a constant (DC) input pass through
 * the filter bit-exact from sample 0 onward, a useful test property.
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
  // One-pole LPF coefficient (D7): y[n] = y[n-1] + alpha*(x[n]-y[n-1]).
  const rc = 1 / (2 * Math.PI * CUTOFF_HZ);
  const dt = 1 / inputRate;
  const alpha = dt / (rc + dt);
  let nextP = 0;
  let globalOffsetSoFar = 0;
  let prevLast: number | undefined;
  let lastFiltered: number | undefined; // warm-started on first sample seen

  function process(quantum: Float32Array): Float32Array {
    const n = quantum.length;
    if (n === 0) return new Float32Array(0);

    // D7: anti-alias LPF pass BEFORE interpolation. Filtering into its own
    // buffer keeps the carry-state interpolation loop below unchanged
    // except for reading `filtered` instead of the raw `quantum`.
    const filtered = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = quantum[i] as number;
      if (lastFiltered === undefined) lastFiltered = x; // warm start, no click
      lastFiltered = lastFiltered + alpha * (x - lastFiltered);
      filtered[i] = lastFiltered;
    }

    const out: number[] = [];
    const upperBound = globalOffsetSoFar + n - 1;
    while (nextP < upperBound) {
      const floorP = Math.floor(nextP);
      const frac = nextP - floorP;
      const idxLow = floorP - globalOffsetSoFar;
      // Invariant (proven in the doc comment above): idxLow is always >= -1
      // here, and idxLow+1 is always a valid index into `filtered` — so
      // these reads are safe despite `noUncheckedIndexedAccess`.
      const s0 =
        idxLow === -1 ? (prevLast as number) : (filtered[idxLow] as number);
      const s1 =
        idxLow === -1
          ? (filtered[0] as number)
          : (filtered[idxLow + 1] as number);
      out.push(s0 + (s1 - s0) * frac);
      nextP += ratio;
    }
    globalOffsetSoFar += n;
    prevLast = filtered[n - 1];
    return new Float32Array(out);
  }

  function flush(): Float32Array {
    // No output sample is ever withheld beyond what `process()` already
    // emitted: a point is only produced once BOTH its bracketing FILTERED
    // input samples are known, so there is nothing left to synthesize at
    // stop without extrapolating audio that was never captured. Reset ALL
    // carried state — resample AND filter (D7) — so the instance is safe to
    // reuse for a fresh capture session with no click/ramp bleed-through.
    nextP = 0;
    globalOffsetSoFar = 0;
    prevLast = undefined;
    lastFiltered = undefined;
    return new Float32Array(0);
  }

  return { process, flush };
}
