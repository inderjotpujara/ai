import { describe, expect, it } from 'vitest';
import {
  getLastAudioContext,
  getLastAudioWorkletNode,
  getLastGetUserMediaConstraints,
  getLastMediaStream,
} from '../../test/setup.ts';
import { createAudioCapture, createDownsampler } from './audio-capture.ts';
import { CUTOFF_HZ } from './downsampler.ts';

/** Small independent reference resampler: recomputes each output sample
 *  directly from `p_k = k * ratio` against the full signal with fresh state
 *  (no carried `prevLast`, no chunk boundaries) — used to correctness-check
 *  the streaming implementation's output against a from-scratch computation,
 *  not merely against itself. */
function naiveResample(signal: Float32Array, ratio: number, k: number): number {
  const p = k * ratio;
  const floorP = Math.floor(p);
  const frac = p - floorP;
  const s0 = signal[floorP] as number;
  const s1 = signal[floorP + 1] as number;
  return s0 + (s1 - s0) * frac;
}

/** Independent (non-implementation) reference for the D7 one-pole LPF —
 *  applied to the FULL, unchunked signal with the same warm-start rule
 *  `createDownsampler` uses (first sample seeds the filter state, avoiding a
 *  startup click/ramp). Because an IIR filter's output only ever depends on
 *  strict sequential sample order (never on chunk boundaries), this
 *  whole-signal computation is bit-identical to the implementation's own
 *  per-chunk carry-state computation — exact equality (not toBeCloseTo) is
 *  therefore a meaningful assertion below, not merely a close approximation. */
function naiveOnePoleFilter(
  signal: Float32Array,
  cutoffHz: number,
  inputRate: number,
): Float32Array {
  const rc = 1 / (2 * Math.PI * cutoffHz);
  const dt = 1 / inputRate;
  const alpha = dt / (rc + dt);
  const out = new Float32Array(signal.length);
  let last: number | undefined;
  for (let i = 0; i < signal.length; i++) {
    const x = signal[i] as number;
    if (last === undefined) last = x;
    last = last + alpha * (x - last);
    out[i] = last;
  }
  return out;
}

/** Filters the FULL signal (`naiveOnePoleFilter`) then reuses the
 *  already-existing `naiveResample` helper on the filtered result — composes
 *  the two independent references instead of hand-deriving decimal literals.
 *  The result is rounded to float32 (`Math.fround`) because the production
 *  `process()` returns a `Float32Array`: its elements only ever hold a
 *  float32-rounded value, so an unrounded float64 reference would differ in
 *  the last bit on non-zero fractional positions and make `toEqual` flaky
 *  for reasons that have nothing to do with correctness. */
function naiveFilteredResample(
  signal: Float32Array,
  ratio: number,
  cutoffHz: number,
  inputRate: number,
  k: number,
): number {
  const filtered = naiveOnePoleFilter(signal, cutoffHz, inputRate);
  return Math.fround(naiveResample(filtered, ratio, k));
}

/** Verbatim pre-D7 algorithm (bare interpolation, no anti-alias stage) —
 *  a standalone "before" snapshot used ONLY as an A/B baseline for the new
 *  aliasing-energy test below; never calls production code. */
function unfilteredReferenceDownsample(
  signal: Float32Array,
  inputRate: number,
): Float32Array {
  const ratio = inputRate / 16000;
  const out: number[] = [];
  let k = 0;
  while (k * ratio < signal.length - 1) {
    const p = k * ratio;
    const floorP = Math.floor(p);
    const frac = p - floorP;
    const s0 = signal[floorP] as number;
    const s1 = signal[floorP + 1] as number;
    out.push(s0 + (s1 - s0) * frac);
    k++;
  }
  return new Float32Array(out);
}

/** Single-frequency-bin DFT magnitude (Goertzel algorithm) — used to measure
 *  how much energy an output signal carries at a specific frequency, without
 *  computing a full FFT. */
function goertzelMagnitude(
  samples: Float32Array,
  targetFreqHz: number,
  sampleRateHz: number,
): number {
  const n = samples.length;
  const k = Math.round((n * targetFreqHz) / sampleRateHz);
  const omega = (2 * Math.PI * k) / n;
  const cosine = Math.cos(omega);
  const coeff = 2 * cosine;
  let s0 = 0;
  let s1 = 0;
  let s2 = 0;
  for (let i = 0; i < n; i++) {
    s0 = (samples[i] as number) + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  const real = s1 - s2 * cosine;
  const imag = s2 * Math.sin(omega);
  return Math.sqrt(real * real + imag * imag);
}

describe('createDownsampler', () => {
  it('produces exact expected samples for a 3:1 ratio (48k→16k) single-call ramp, filtered then interpolated', () => {
    const input = new Float32Array([0, 3, 6, 9, 12, 15]);
    const downsampler = createDownsampler(48000);
    const output = downsampler.process(input);
    const expected = [0, 1].map((k) =>
      naiveFilteredResample(input, 3, CUTOFF_HZ, 48000, k),
    );
    expect(Array.from(output)).toEqual(expected);
  });

  it('carries BOTH the resample AND the LPF state correctly across a chunk boundary: two chunks equal one big chunk', () => {
    const wholeInput = new Float32Array([
      0, 3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33,
    ]);
    const oneShot = createDownsampler(48000);
    const referenceOutput = Array.from(oneShot.process(wholeInput));

    const chunked = createDownsampler(48000);
    const chunk1 = wholeInput.subarray(0, 6);
    const chunk2 = wholeInput.subarray(6, 12);
    const chunkedOutput = [
      ...chunked.process(chunk1),
      ...chunked.process(chunk2),
    ];

    expect(chunkedOutput).toEqual(referenceOutput);
    const expected = [0, 1, 2, 3].map((k) =>
      naiveFilteredResample(wholeInput, 3, CUTOFF_HZ, 48000, k),
    );
    expect(referenceOutput).toEqual(expected);
  });

  it('is invariant to arbitrary non-aligned chunk sizes, including a boundary requiring the carried prevLast sample (fractional 1.5:1 ratio)', () => {
    const wholeInput = new Float32Array([0, 1, 2, 3, 4, 5]);
    const oneShot = createDownsampler(24000);
    const referenceOutput = Array.from(oneShot.process(wholeInput));
    const expected = [0, 1, 2, 3].map((k) =>
      naiveFilteredResample(wholeInput, 1.5, CUTOFF_HZ, 24000, k),
    );
    expect(referenceOutput).toEqual(expected);

    const chunked = createDownsampler(24000);
    const out1 = chunked.process(wholeInput.subarray(0, 2));
    const out2 = chunked.process(wholeInput.subarray(2, 3));
    const out3 = chunked.process(wholeInput.subarray(3, 6));
    expect([...out1, ...out2, ...out3]).toEqual(referenceOutput);
  });

  it('linearly interpolates at fractional positions off the 0/0.5 grid (44.1k-style ratio), filtered then interpolated', () => {
    const input = new Float32Array([0, 4, 8, 12, 16]); // x[i] = 4i
    const d = createDownsampler(20000); // ratio = 1.25
    const out = Array.from(d.process(input));
    const expected = [0, 1, 2, 3].map((k) =>
      naiveFilteredResample(input, 1.25, CUTOFF_HZ, 20000, k),
    );
    expect(out).toEqual(expected);
  });

  it('is invariant to arbitrary non-128-aligned AudioWorklet-style quantum sizes over a longer signal', () => {
    // A realistic 48k→16k conversion over exactly 1 second (48000 samples),
    // once as native 128-frame render quanta, once chopped into deliberately
    // odd, non-aligned sizes. Same total length, different boundaries.
    const total = 48000;
    const signal = new Float32Array(total);
    for (let i = 0; i < total; i++) signal[i] = Math.sin(i * 0.01);

    const asQuanta128 = createDownsampler(48000);
    const quantaOutput: number[] = [];
    for (let i = 0; i < total; i += 128) {
      quantaOutput.push(...asQuanta128.process(signal.subarray(i, i + 128)));
    }

    const oddSizes = [37, 91, 5, 200, 1, 333, 128, 4001];
    const asOddChunks = createDownsampler(48000);
    const oddOutput: number[] = [];
    let offset = 0;
    for (const size of oddSizes) {
      oddOutput.push(
        ...asOddChunks.process(signal.subarray(offset, offset + size)),
      );
      offset += size;
    }
    // Drain the remainder in one final chunk so both partitions cover the
    // exact same total length.
    oddOutput.push(...asOddChunks.process(signal.subarray(offset, total)));

    expect(oddOutput).toEqual(quantaOutput);
    // 48000 input samples at a 3:1 ratio yields exactly 16000 output samples
    // (k ranges 0..15999, since 15999*3 = 47997 < 47999 = total-1, and
    // 16000*3 = 48000 is not < 47999).
    expect(quantaOutput.length).toBe(16000);

    // Correctness, not just self-consistency: a handful of samples spanning
    // the start, an early boundary, and the tail, verified against a fresh
    // naive reference computed directly from the full signal (ratio=3 is
    // exact/integer here, so frac is always 0 and s0+(s1-s0)*0 === s0 with no
    // rounding — exact equality is meaningful, same reasoning as the first
    // test in this file).
    for (const k of [0, 1, 2, 500, 4999, 8192, 15999]) {
      expect(quantaOutput[k]).toBe(
        naiveFilteredResample(signal, 3, CUTOFF_HZ, 48000, k),
      );
    }
  });

  it('flush() returns empty and resets state (including the LPF carry) for reuse', () => {
    const input = new Float32Array([0, 3, 6, 9, 12, 15]);
    const downsampler = createDownsampler(48000);
    downsampler.process(input);
    const residual = downsampler.flush();
    expect(Array.from(residual)).toEqual([]);

    const reused = downsampler.process(input);
    const fresh = createDownsampler(48000).process(input);
    expect(Array.from(reused)).toEqual(Array.from(fresh));
  });

  it('never throws and returns empty on a zero-length quantum', () => {
    const downsampler = createDownsampler(48000);
    expect(Array.from(downsampler.process(new Float32Array(0)))).toEqual([]);
    const input = new Float32Array([0, 3, 6, 9, 12, 15]);
    const expected = [0, 1].map((k) =>
      naiveFilteredResample(input, 3, CUTOFF_HZ, 48000, k),
    );
    expect(Array.from(downsampler.process(input))).toEqual(expected);
  });

  it('the D7 anti-alias LPF measurably reduces aliasing energy vs. raw interpolation for an above-Nyquist tone (reference comparison, not bit-exact)', () => {
    const inputRate = 48000;
    const durationSec = 0.2;
    const n = Math.floor(inputRate * durationSec);
    const toneHz = 9500; // above the 8kHz output Nyquist — a classic fold-back case
    const signal = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      signal[i] = Math.sin((2 * Math.PI * toneHz * i) / inputRate);
    }

    const filtered = createDownsampler(inputRate).process(signal);
    const unfiltered = unfilteredReferenceDownsample(signal, inputRate);

    const aliasFreqHz = 16000 - toneHz; // 6500 Hz — where 9500Hz folds to at 16kHz
    const filteredAliasEnergy = goertzelMagnitude(filtered, aliasFreqHz, 16000);
    const unfilteredAliasEnergy = goertzelMagnitude(
      unfiltered,
      aliasFreqHz,
      16000,
    );

    // A one-pole LPF has a gentle 6dB/octave rolloff (no brick-wall cutoff),
    // so at 9500Hz — only ~1.27x CUTOFF_HZ — it attenuates to ~0.51x, not
    // to a fraction of that. 0.6 is a threshold with real margin below that
    // verified attenuation, while still proving a substantial (~40%),
    // non-flaky reduction in fold-back energy from the anti-alias stage.
    expect(filteredAliasEnergy).toBeLessThan(unfilteredAliasEnergy * 0.6);
  });
});

describe('createAudioCapture', () => {
  it('start() requests AEC/noise-suppression/AGC getUserMedia, opens an AudioContext + worklet, and flips active', async () => {
    const capture = createAudioCapture();
    expect(capture.active).toBe(false);
    await capture.start();
    expect(capture.active).toBe(true);
    expect(getLastGetUserMediaConstraints()).toEqual({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    expect(getLastAudioWorkletNode()).toBeDefined();
  });

  it('forwards worklet chunks to onChunk subscribers and a computed RMS level to onLevel subscribers', async () => {
    const capture = createAudioCapture();
    await capture.start();
    const chunks: Float32Array[] = [];
    const levels: number[] = [];
    capture.onChunk((c) => chunks.push(c));
    capture.onLevel((l) => levels.push(l));

    const node = getLastAudioWorkletNode();
    const chunk = new Float32Array([1, -1, 1, -1]); // RMS = 1
    node?.port.onmessage?.({ data: chunk } as MessageEvent);

    expect(chunks).toEqual([chunk]);
    expect(levels).toEqual([1]);
  });

  it('onChunk/onLevel unsubscribe stops further callbacks', async () => {
    const capture = createAudioCapture();
    await capture.start();
    const chunks: Float32Array[] = [];
    const unsubscribe = capture.onChunk((c) => chunks.push(c));
    unsubscribe();

    const node = getLastAudioWorkletNode();
    node?.port.onmessage?.({ data: new Float32Array([0.5]) } as MessageEvent);

    expect(chunks).toEqual([]);
  });

  it('stop() stops every MediaStream track, closes the AudioContext, and flips active off', async () => {
    const capture = createAudioCapture();
    await capture.start();
    const stream = getLastMediaStream();
    const ctx = getLastAudioContext();
    await capture.stop();
    expect(capture.active).toBe(false);
    for (const track of stream?.getTracks() ?? []) {
      expect(track.readyState).toBe('ended');
    }
    expect(ctx?.close).toHaveBeenCalledTimes(1);
  });
});
