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
