import { describe, expect, it } from 'vitest';
import { createDownsampler } from './audio-capture.ts';

describe('createDownsampler', () => {
  it('produces exact expected samples for a 3:1 ratio (48k→16k) single-call ramp, zero floating error', () => {
    // x[i] = 3*i so every interpolated point lands exactly on an integer
    // sample with frac=0 — the arithmetic has no rounding, so exact
    // equality (not toBeCloseTo) is a meaningful assertion.
    const downsampler = createDownsampler(48000);
    const input = new Float32Array([0, 3, 6, 9, 12, 15]);
    const output = downsampler.process(input);
    expect(Array.from(output)).toEqual([0, 9]);
  });

  it('carries state correctly across a chunk boundary: two chunks of the same ramp equal one big chunk', () => {
    const oneShot = createDownsampler(48000);
    const wholeInput = new Float32Array([
      0, 3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33,
    ]);
    const referenceOutput = Array.from(oneShot.process(wholeInput));

    const chunked = createDownsampler(48000);
    const chunk1 = wholeInput.subarray(0, 6);
    const chunk2 = wholeInput.subarray(6, 12);
    const chunkedOutput = [
      ...chunked.process(chunk1),
      ...chunked.process(chunk2),
    ];

    expect(chunkedOutput).toEqual(referenceOutput);
    expect(referenceOutput).toEqual([0, 9, 18, 27]);
  });

  it('is invariant to arbitrary non-aligned chunk sizes, including a boundary that requires the carried prevLast sample (a fractional 1.5:1 ratio)', () => {
    // x[i] = i, ratio 24000/16000 = 1.5. Chunked as [2, 1, 3] deliberately
    // straddles an output position that falls exactly on the boundary
    // between chunk1's last sample and chunk2's first sample — this is the
    // one case that requires `prevLast`, not just direct quantum indexing.
    const wholeInput = new Float32Array([0, 1, 2, 3, 4, 5]);

    const oneShot = createDownsampler(24000);
    const referenceOutput = Array.from(oneShot.process(wholeInput));
    expect(referenceOutput).toEqual([0, 1.5, 3, 4.5]);

    const chunked = createDownsampler(24000);
    const out1 = chunked.process(wholeInput.subarray(0, 2)); // [0, 1]
    const out2 = chunked.process(wholeInput.subarray(2, 3)); // [2] — triggers prevLast
    const out3 = chunked.process(wholeInput.subarray(3, 6)); // [3, 4, 5]
    const chunkedOutput = [...out1, ...out2, ...out3];

    expect(chunkedOutput).toEqual(referenceOutput);
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
  });

  it('flush() returns empty (no output sample is ever withheld beyond what process() already emitted) and resets state for reuse', () => {
    const downsampler = createDownsampler(48000);
    downsampler.process(new Float32Array([0, 3, 6, 9, 12, 15]));
    const residual = downsampler.flush();
    expect(Array.from(residual)).toEqual([]);

    // After flush, a fresh sequence must behave identically to a brand-new
    // instance — no leftover state bleeds into the next capture session.
    const reused = downsampler.process(new Float32Array([0, 3, 6, 9, 12, 15]));
    const fresh = createDownsampler(48000).process(
      new Float32Array([0, 3, 6, 9, 12, 15]),
    );
    expect(Array.from(reused)).toEqual(Array.from(fresh));
  });

  it('never throws and returns empty on a zero-length quantum', () => {
    const downsampler = createDownsampler(48000);
    expect(Array.from(downsampler.process(new Float32Array(0)))).toEqual([]);
    // A real quantum after the empty one still works normally.
    expect(
      Array.from(downsampler.process(new Float32Array([0, 3, 6, 9, 12, 15]))),
    ).toEqual([0, 9]);
  });
});
