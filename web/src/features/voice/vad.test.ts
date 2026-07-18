import type { VoiceFrames } from '@contracts';
import { describe, expect, it, vi } from 'vitest';
import { createSegmenter } from './vad.ts';

function tone(length: number, fill = 0.5): Float32Array {
  return new Float32Array(length).fill(fill);
}

describe('createSegmenter — hold-to-talk (gated: false)', () => {
  it('buffers every pushed frame regardless of isSpeech, emitting nothing until flush()', () => {
    const segmenter = createSegmenter({
      silenceMs: 500,
      gated: false,
      frameMs: 32,
    });
    const onSegment = vi.fn();
    segmenter.onSegment(onSegment);
    segmenter.pushFrame(tone(512), true);
    segmenter.pushFrame(tone(256), false); // ignored isSpeech — hold mode never gates
    expect(onSegment).not.toHaveBeenCalled();
  });

  it('flush() emits exactly one segment concatenating every buffered chunk in push order', () => {
    const segmenter = createSegmenter({
      silenceMs: 500,
      gated: false,
      frameMs: 32,
    });
    const onSegment = vi.fn();
    segmenter.onSegment(onSegment);
    segmenter.pushFrame(tone(4, 0.1), true);
    segmenter.pushFrame(tone(4, 0.2), false);
    segmenter.pushFrame(tone(4, 0.3), false);
    segmenter.flush();
    expect(onSegment).toHaveBeenCalledTimes(1);
    const frames = onSegment.mock.calls[0]?.[0] as VoiceFrames;
    expect(frames.sampleRate).toBe(16000);
    // Compare against a Float32Array round-trip of the expected values (not
    // the float64 literals directly) — `frames.samples` is a Float32Array,
    // so e.g. 0.1 is actually stored as 0.10000000149011612; round-tripping
    // both sides through Float32 keeps this a strict order/no-drop
    // assertion without failing on float32 rounding noise.
    expect(Array.from(frames.samples as Float32Array)).toEqual(
      Array.from(
        new Float32Array([
          0.1, 0.1, 0.1, 0.1, 0.2, 0.2, 0.2, 0.2, 0.3, 0.3, 0.3, 0.3,
        ]),
      ),
    );
  });

  it('does not truncate a frame pushed immediately before flush() (the release-boundary residual, §7.1 c)', () => {
    const segmenter = createSegmenter({
      silenceMs: 500,
      gated: false,
      frameMs: 32,
    });
    const onSegment = vi.fn();
    segmenter.onSegment(onSegment);
    segmenter.pushFrame(tone(2, 0.9), true);
    segmenter.pushFrame(tone(2, 0.8), true); // the trailing "residual" flushed at release
    segmenter.flush();
    const frames = onSegment.mock.calls[0]?.[0] as VoiceFrames;
    expect(Array.from(frames.samples as Float32Array)).toEqual(
      Array.from(new Float32Array([0.9, 0.9, 0.8, 0.8])),
    );
  });

  it('flush() with nothing buffered emits nothing (no phantom empty segment)', () => {
    const segmenter = createSegmenter({
      silenceMs: 500,
      gated: false,
      frameMs: 32,
    });
    const onSegment = vi.fn();
    segmenter.onSegment(onSegment);
    segmenter.flush();
    expect(onSegment).not.toHaveBeenCalled();
  });

  it('reset() clears buffered audio without emitting a segment', () => {
    const segmenter = createSegmenter({
      silenceMs: 500,
      gated: false,
      frameMs: 32,
    });
    const onSegment = vi.fn();
    segmenter.onSegment(onSegment);
    segmenter.pushFrame(tone(4), true);
    segmenter.reset();
    segmenter.flush();
    expect(onSegment).not.toHaveBeenCalled();
  });

  it('a second flush() after an emit is a no-op (buffer already drained)', () => {
    const segmenter = createSegmenter({
      silenceMs: 500,
      gated: false,
      frameMs: 32,
    });
    const onSegment = vi.fn();
    segmenter.onSegment(onSegment);
    segmenter.pushFrame(tone(4), true);
    segmenter.flush();
    segmenter.flush();
    expect(onSegment).toHaveBeenCalledTimes(1);
  });

  it('onSegment() returns an unsubscribe function', () => {
    const segmenter = createSegmenter({
      silenceMs: 500,
      gated: false,
      frameMs: 32,
    });
    const onSegment = vi.fn();
    const off = segmenter.onSegment(onSegment);
    off();
    segmenter.pushFrame(tone(4), true);
    segmenter.flush();
    expect(onSegment).not.toHaveBeenCalled();
  });
});

describe('createSegmenter — tap-to-toggle (gated: true)', () => {
  it('closes a segment after sustained silence >= silenceMs, trimming the trailing silence off the emitted audio', () => {
    const segmenter = createSegmenter({
      silenceMs: 100,
      gated: true,
      frameMs: 32,
    });
    const onSegment = vi.fn();
    segmenter.onSegment(onSegment);
    segmenter.pushFrame(tone(512, 0.5), true); // 32ms speech
    segmenter.pushFrame(tone(512, 0), false); // 32ms silent
    segmenter.pushFrame(tone(512, 0), false); // 64ms
    segmenter.pushFrame(tone(512, 0), false); // 96ms
    expect(onSegment).not.toHaveBeenCalled(); // not yet sustained
    segmenter.pushFrame(tone(512, 0), false); // 128ms >= 100ms — closes
    expect(onSegment).toHaveBeenCalledTimes(1);
    const frames = onSegment.mock.calls[0]?.[0] as VoiceFrames;
    // only the one speech chunk survives trimming — no silent tail. Assert
    // CONTENT, not just length: a speech (fill 0.5) and silence (fill 0)
    // chunk are both 512 samples, so an off-by-one in the trim `cut` index
    // that retained a silent chunk instead of the speech chunk would still
    // emit 512 samples and pass a length-only check. Round-trip both sides
    // through Float32Array (matches Task 10's convention) to sidestep
    // float32-precision noise.
    expect(Array.from(frames.samples as Float32Array)).toEqual(
      Array.from(new Float32Array(512).fill(0.5)),
    );
  });

  it('does not double-transcribe on a jittery VAD flip that never sustains past silenceMs, but a genuine sustained silence run still closes (§7.1 b)', () => {
    const segmenter = createSegmenter({
      silenceMs: 100,
      gated: true,
      frameMs: 32,
    });
    const onSegment = vi.fn();
    segmenter.onSegment(onSegment);
    // Three silence runs of 2 chunks (64ms) each, separated by a speech
    // frame that must reset the silence clock — no single run reaches
    // silenceMs (100ms), but the SUM across all three runs (192ms) does.
    // This discriminates a segmenter that forgot to reset
    // `silentMsAccumulated` on speech resumption: without the reset, the
    // accumulator would carry over across the speech frame and cross
    // 100ms partway through the SECOND run (64ms carried + 64ms new =
    // 128ms), wrongly closing the segment right there — well before this
    // test's own sustained-silence check at the end. With the reset intact,
    // no run individually reaches 100ms, so nothing closes here.
    segmenter.pushFrame(tone(512), true);
    segmenter.pushFrame(tone(512, 0), false); // 32ms silent
    segmenter.pushFrame(tone(512, 0), false); // 64ms silent (run 1, < 100ms)
    segmenter.pushFrame(tone(512), true); // speech resumes — resets clock
    segmenter.pushFrame(tone(512, 0), false); // 32ms silent
    segmenter.pushFrame(tone(512, 0), false); // 64ms silent (run 2, < 100ms —
    // a no-reset bug would be at 64+64=128ms here and would have closed)
    segmenter.pushFrame(tone(512), true); // speech resumes — resets clock again
    segmenter.pushFrame(tone(512, 0), false); // 32ms silent
    segmenter.pushFrame(tone(512, 0), false); // 64ms silent (run 3, < 100ms)
    expect(onSegment).not.toHaveBeenCalled(); // no single run ever sustained 100ms

    // Pin the other direction too: a genuine sustained run crossing
    // silenceMs from here still closes correctly.
    segmenter.pushFrame(tone(512, 0), false); // 96ms
    segmenter.pushFrame(tone(512, 0), false); // 128ms >= 100ms — closes
    expect(onSegment).toHaveBeenCalledTimes(1);
  });

  it('a very short utterance (a single speech chunk) still emits once sustained silence follows (§7.1 b — no missed segment)', () => {
    const segmenter = createSegmenter({
      silenceMs: 64,
      gated: true,
      frameMs: 32,
    });
    const onSegment = vi.fn();
    segmenter.onSegment(onSegment);
    segmenter.pushFrame(tone(512), true); // one 32ms speech chunk
    segmenter.pushFrame(tone(512, 0), false); // 32ms silent
    segmenter.pushFrame(tone(512, 0), false); // 64ms — closes
    expect(onSegment).toHaveBeenCalledTimes(1);
    const frames = onSegment.mock.calls[0]?.[0] as VoiceFrames;
    // CONTENT assertion (see the sustained-silence-close test above for
    // why length alone doesn't lock the trim boundary).
    expect(Array.from(frames.samples as Float32Array)).toEqual(
      Array.from(new Float32Array(512).fill(0.5)),
    );
  });

  it('an utterance with multiple leading speech chunks retains and concatenates all of them, trimmed of only the closing silence', () => {
    const segmenter = createSegmenter({
      silenceMs: 64,
      gated: true,
      frameMs: 32,
    });
    const onSegment = vi.fn();
    segmenter.onSegment(onSegment);
    segmenter.pushFrame(tone(512, 0.6), true); // speech chunk 1
    segmenter.pushFrame(tone(512, 0.7), true); // speech chunk 2
    segmenter.pushFrame(tone(512, 0), false); // 32ms silent
    segmenter.pushFrame(tone(512, 0), false); // 64ms — closes
    expect(onSegment).toHaveBeenCalledTimes(1);
    const frames = onSegment.mock.calls[0]?.[0] as VoiceFrames;
    expect(Array.from(frames.samples as Float32Array)).toEqual(
      Array.from(
        new Float32Array([
          ...new Float32Array(512).fill(0.6),
          ...new Float32Array(512).fill(0.7),
        ]),
      ),
    );
  });

  it('a tap-to-toggle session spans multiple speech/silence cycles, each closing its own segment independently', () => {
    const segmenter = createSegmenter({
      silenceMs: 64,
      gated: true,
      frameMs: 32,
    });
    const onSegment = vi.fn();
    segmenter.onSegment(onSegment);
    // cycle 1
    segmenter.pushFrame(tone(512, 0.1), true);
    segmenter.pushFrame(tone(512, 0), false);
    segmenter.pushFrame(tone(512, 0), false); // closes cycle 1
    // cycle 2 (re-armed automatically — no explicit re-arm call needed)
    segmenter.pushFrame(tone(512, 0.2), true);
    segmenter.pushFrame(tone(512, 0), false);
    segmenter.pushFrame(tone(512, 0), false); // closes cycle 2
    expect(onSegment).toHaveBeenCalledTimes(2);
    const frames1 = onSegment.mock.calls[0]?.[0] as VoiceFrames;
    const frames2 = onSegment.mock.calls[1]?.[0] as VoiceFrames;
    expect((frames1.samples as Float32Array)[0]).toBeCloseTo(0.1);
    expect((frames2.samples as Float32Array)[0]).toBeCloseTo(0.2);
  });

  it('leading silence before any speech is ignored (never buffered, never closes an empty segment)', () => {
    const segmenter = createSegmenter({
      silenceMs: 64,
      gated: true,
      frameMs: 32,
    });
    const onSegment = vi.fn();
    segmenter.onSegment(onSegment);
    segmenter.pushFrame(tone(512, 0), false);
    segmenter.pushFrame(tone(512, 0), false);
    segmenter.pushFrame(tone(512, 0), false);
    expect(onSegment).not.toHaveBeenCalled();
  });

  it('flush() during an open (not-yet-silence-closed) tap-toggle segment closes it immediately with whatever is buffered', () => {
    const segmenter = createSegmenter({
      silenceMs: 1000,
      gated: true,
      frameMs: 32,
    });
    const onSegment = vi.fn();
    segmenter.onSegment(onSegment);
    segmenter.pushFrame(tone(512, 0.4), true);
    segmenter.flush(); // manual stop before silence would ever have closed it
    expect(onSegment).toHaveBeenCalledTimes(1);
    const frames = onSegment.mock.calls[0]?.[0] as VoiceFrames;
    expect((frames.samples as Float32Array)[0]).toBeCloseTo(0.4);
  });
});
