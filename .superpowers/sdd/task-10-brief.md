### Task 10: `vad.ts` — pure segmenter, hold-to-talk (non-gated) mode

**Files:**
- Create: `web/src/features/voice/vad.ts`
- Test: `web/src/features/voice/vad.test.ts`

**Interfaces:**
- Consumes: `VoiceFrames` (`{ samples: Float32Array; sampleRate: 16000 }`) from `@contracts` (Part A Task 1 — the lifted contract; `src/voice/types.ts` re-exports the same type for the CLI side, so this import is the one, single source).
- Produces (locked, verbatim — used by Task 11 in the same file, and by Task 12's `use-voice-input.ts`):
  ```ts
  export type SegmenterOpts = { silenceMs: number; gated: boolean; frameMs: number };
  export type Segmenter = {
    pushFrame(chunk: Float32Array, isSpeech: boolean): void;
    flush(): void;
    onSegment(cb: (frames: VoiceFrames) => void): () => void;
    reset(): void;
  };
  export function createSegmenter(opts: SegmenterOpts): Segmenter;
  ```

- [ ] **Step 1: Write the failing tests (hold-to-talk / `gated: false`)**

Create `web/src/features/voice/vad.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { createSegmenter } from './vad.ts';

function tone(length: number, fill = 0.5): Float32Array {
  return new Float32Array(length).fill(fill);
}

describe('createSegmenter — hold-to-talk (gated: false)', () => {
  it('buffers every pushed frame regardless of isSpeech, emitting nothing until flush()', () => {
    const segmenter = createSegmenter({ silenceMs: 500, gated: false, frameMs: 32 });
    const onSegment = vi.fn();
    segmenter.onSegment(onSegment);
    segmenter.pushFrame(tone(512), true);
    segmenter.pushFrame(tone(256), false); // ignored isSpeech — hold mode never gates
    expect(onSegment).not.toHaveBeenCalled();
  });

  it('flush() emits exactly one segment concatenating every buffered chunk in push order', () => {
    const segmenter = createSegmenter({ silenceMs: 500, gated: false, frameMs: 32 });
    const onSegment = vi.fn();
    segmenter.onSegment(onSegment);
    segmenter.pushFrame(tone(4, 0.1), true);
    segmenter.pushFrame(tone(4, 0.2), false);
    segmenter.pushFrame(tone(4, 0.3), false);
    segmenter.flush();
    expect(onSegment).toHaveBeenCalledTimes(1);
    const frames = onSegment.mock.calls[0][0];
    expect(frames.sampleRate).toBe(16000);
    expect(Array.from(frames.samples as Float32Array)).toEqual([
      0.1, 0.1, 0.1, 0.1, 0.2, 0.2, 0.2, 0.2, 0.3, 0.3, 0.3, 0.3,
    ]);
  });

  it('does not truncate a frame pushed immediately before flush() (the release-boundary residual, §7.1 c)', () => {
    const segmenter = createSegmenter({ silenceMs: 500, gated: false, frameMs: 32 });
    const onSegment = vi.fn();
    segmenter.onSegment(onSegment);
    segmenter.pushFrame(tone(2, 0.9), true);
    segmenter.pushFrame(tone(2, 0.8), true); // the trailing "residual" flushed at release
    segmenter.flush();
    const frames = onSegment.mock.calls[0][0];
    expect(Array.from(frames.samples as Float32Array)).toEqual([0.9, 0.9, 0.8, 0.8]);
  });

  it('flush() with nothing buffered emits nothing (no phantom empty segment)', () => {
    const segmenter = createSegmenter({ silenceMs: 500, gated: false, frameMs: 32 });
    const onSegment = vi.fn();
    segmenter.onSegment(onSegment);
    segmenter.flush();
    expect(onSegment).not.toHaveBeenCalled();
  });

  it('reset() clears buffered audio without emitting a segment', () => {
    const segmenter = createSegmenter({ silenceMs: 500, gated: false, frameMs: 32 });
    const onSegment = vi.fn();
    segmenter.onSegment(onSegment);
    segmenter.pushFrame(tone(4), true);
    segmenter.reset();
    segmenter.flush();
    expect(onSegment).not.toHaveBeenCalled();
  });

  it('a second flush() after an emit is a no-op (buffer already drained)', () => {
    const segmenter = createSegmenter({ silenceMs: 500, gated: false, frameMs: 32 });
    const onSegment = vi.fn();
    segmenter.onSegment(onSegment);
    segmenter.pushFrame(tone(4), true);
    segmenter.flush();
    segmenter.flush();
    expect(onSegment).toHaveBeenCalledTimes(1);
  });

  it('onSegment() returns an unsubscribe function', () => {
    const segmenter = createSegmenter({ silenceMs: 500, gated: false, frameMs: 32 });
    const onSegment = vi.fn();
    const off = segmenter.onSegment(onSegment);
    off();
    segmenter.pushFrame(tone(4), true);
    segmenter.flush();
    expect(onSegment).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && bun run test -- vad.test.ts`
Expected: FAIL — `Cannot find module './vad.ts'` (or all assertions fail once a stub exists). No implementation exists yet.

- [ ] **Step 3: Write the implementation**

Create `web/src/features/voice/vad.ts`:

```ts
import type { VoiceFrames } from '@contracts';

export type SegmenterOpts = { silenceMs: number; gated: boolean; frameMs: number };

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
 *    release-boundary residual, §7.1 c).
 *  - `true` (tap-to-toggle): `isSpeech` flips gate segment boundaries —
 *    a speech frame (re)starts/extends the current segment and resets the
 *    silence clock; a silent frame is buffered (kept, in case speech
 *    resumes) and accumulates against `silenceMs`; once sustained silence
 *    reaches `silenceMs`, the segment closes, with the trailing silent
 *    chunks trimmed back off the emitted audio (they are not speech).
 *    A tap-to-toggle session can close/reopen many segments in a row
 *    (§7.1 b — exactly one transcribe call per speech/silence cycle).
 */
export function createSegmenter(opts: SegmenterOpts): Segmenter {
  const { silenceMs, gated, frameMs } = opts;
  let buffer: Float32Array[] = [];
  let inSegment = false;
  let silentMsAccumulated = 0;
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
    if (buffer.length === 0) return;
    const samples = concat(buffer);
    buffer = [];
    const frames: VoiceFrames = { samples, sampleRate: 16000 };
    for (const cb of listeners) cb(frames);
  }

  function closeSustainedSilence(): void {
    // Trim the trailing silent chunks themselves back off the emitted
    // audio: walk back from the end, summing each chunk's duration, until
    // the accumulated trim matches the silence total we tracked — that
    // boundary is exactly the end of the last speech-bearing chunk.
    let trimmedMs = 0;
    let cut = buffer.length;
    for (let i = buffer.length - 1; i >= 0; i -= 1) {
      trimmedMs += chunkDurationMs(buffer[i]);
      cut = i;
      if (trimmedMs >= silentMsAccumulated) break;
    }
    buffer = buffer.slice(0, cut);
    emit();
  }

  function pushFrame(chunk: Float32Array, isSpeech: boolean): void {
    if (!gated) {
      buffer.push(chunk);
      inSegment = true;
      return;
    }
    if (isSpeech) {
      buffer.push(chunk);
      inSegment = true;
      silentMsAccumulated = 0;
      return;
    }
    if (!inSegment) return; // silence before any speech started this cycle
    buffer.push(chunk);
    silentMsAccumulated += chunkDurationMs(chunk);
    if (silentMsAccumulated >= silenceMs) closeSustainedSilence();
  }

  function flush(): void {
    emit();
  }

  function reset(): void {
    buffer = [];
    inSegment = false;
    silentMsAccumulated = 0;
  }

  function onSegment(cb: (frames: VoiceFrames) => void): () => void {
    listeners.add(cb);
    return () => listeners.delete(cb);
  }

  return { pushFrame, flush, onSegment, reset };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd web && bun run test -- vad.test.ts`
Expected: PASS — 7/7 (the 6 hold-to-talk tests above; Task 11 appends tap-toggle tests to the same file).

- [ ] **Step 5: Gate + commit**

Run: `cd web && bun run typecheck && cd web && bun run lint`

```bash
git add web/src/features/voice/vad.ts web/src/features/voice/vad.test.ts
git commit -m "feat(voice): add createSegmenter pure state machine (hold-to-talk mode)"
```

---

