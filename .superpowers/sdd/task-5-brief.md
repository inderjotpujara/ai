### Task 5: `createDownsampler` — the pure, carry-state 48k→16k resampler (§7.1 correctness surface)

This is the single most correctness-critical function in Phase 7 (spec §7.1(a)). It must carry fractional-sample state across arbitrary `process()` call boundaries (the AudioWorklet's 128-frame native quanta) with **no dropped or duplicated samples** — mirroring `src/voice/capture.ts`'s `carryPcmChunk` leftover-byte-carry pattern, adapted from byte-alignment to continuous-time linear-interpolation resampling.

**The algorithm (so the implementer doesn't have to re-derive it):** output samples sit on a continuous grid `p_k = k * ratio` (where `ratio = inputRate / 16000`), in GLOBAL input-sample-index units, starting at `k=0`. State carried between calls: `nextP` (the next `k*ratio` position to compute), `globalOffsetSoFar` (total input samples consumed across all previous calls — i.e., the global index of the FIRST sample in the quantum about to be processed), and `prevLast` (the last sample value of the previous quantum, needed only when an output position's lower interpolation index falls exactly on the previous quantum's last sample). Per call: `idxLow = floor(nextP) - globalOffsetSoFar` is provably always `>= -1` (an inductive invariant — the loop only ever stops once `nextP` is within one sample of running out of the CURRENT quantum's data, so the next call can never need to look back more than one sample); `idxLow === -1` means "use `prevLast`", otherwise index directly into the current quantum. This makes the function's output **provably invariant to how the same total input is chunked** — re-chunking differently only changes which call computes which output sample, never the sequence of floating-point operations performed (same `nextP` value, same formula), so chunked output is bit-identical to a single-call reference.

**Files:**
- Create: `web/src/features/voice/audio-capture.ts` (this task only adds `createDownsampler`; `createAudioCapture` is Task 6, appended to the same file)
- Test: `web/src/features/voice/audio-capture.test.ts`

**Interfaces:**
- Consumes: nothing (pure function, no imports beyond `Float32Array`).
- Produces: `export type DownsampleState = { carry: number };` (documented but not directly constructed by callers — internal shape note per `phase7-interfaces.md`) and `export function createDownsampler(inputRate: number): { process(quantum: Float32Array): Float32Array; flush(): Float32Array };`. Consumed by `downsample-worklet.ts` (Task 6).

- [ ] **Step 1: Write the failing tests**

Create `web/src/features/voice/audio-capture.test.ts`:

```ts
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
    const wholeInput = new Float32Array([0, 3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33]);
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
      oddOutput.push(...asOddChunks.process(signal.subarray(offset, offset + size)));
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && bun run test -- features/voice/audio-capture.test.ts`
Expected: FAIL — `error: Cannot find module './audio-capture.ts'` (the file doesn't exist yet).

- [ ] **Step 3: Write minimal implementation**

Create `web/src/features/voice/audio-capture.ts`:

```ts
const OUTPUT_RATE = 16000;

/** Fractional carry state a `createDownsampler` instance threads across
 *  `process()` calls (documented shape; callers never construct one
 *  directly — it lives inside the closure returned by `createDownsampler`). */
export type DownsampleState = { carry: number };

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
      const s0 = idxLow === -1 ? (prevLast as number) : (quantum[idxLow] as number);
      const s1 = idxLow === -1 ? (quantum[0] as number) : (quantum[idxLow + 1] as number);
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && bun run test -- features/voice/audio-capture.test.ts`
Expected: PASS (7 tests).

Run: `cd web && bun run typecheck`
Expected: PASS (verify the `noUncheckedIndexedAccess`-driven casts above compile cleanly).

- [ ] **Step 5: Commit**

```bash
git add web/src/features/voice/audio-capture.ts web/src/features/voice/audio-capture.test.ts
git commit -m "feat(voice): pure carry-state 48k downsampler with chunk-invariance tests (D3, spec §7.1)"
```

