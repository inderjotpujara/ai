import { describe, expect, it } from 'bun:test';
import {
  captureFromMic,
  MAX_CAPTURE_SAMPLES,
} from '../../src/voice/capture.ts';

const cfg = { modelDir: '/m', ffmpeg: 'ffmpeg', timeoutMs: 10000 };

function fakeIo(chunks: Float32Array[], stopVia: 'silence' | 'space') {
  let keyCb: (k: string) => void = () => {};
  return {
    io: {
      async start() {
        return {
          frames: (async function* () {
            for (const c of chunks) yield c;
          })(),
          silenceSignaled:
            stopVia === 'silence'
              ? Promise.resolve()
              : new Promise<void>(() => {}),
          async stop() {},
        };
      },
      onKey(cb: (k: 'space' | 'enter' | 'ctrl-c') => void) {
        keyCb = cb as (k: string) => void;
        return () => {};
      },
      print() {},
    },
    pressSpace: () => keyCb('space'),
  };
}

describe('captureFromMic', () => {
  it('accumulates frames and stops on silence', async () => {
    const { io, pressSpace } = fakeIo(
      [new Float32Array(800).fill(0.2)],
      'silence',
    );
    const p = captureFromMic(cfg, io);
    pressSpace(); // begin recording
    const frames = await p;
    expect(frames.samples.length).toBe(800);
  });

  it('throws mic-permission hint on all-zero (silent) capture', async () => {
    const { io, pressSpace } = fakeIo([new Float32Array(800)], 'silence');
    const p = captureFromMic(cfg, io);
    pressSpace();
    await expect(p).rejects.toThrow(/microphone/i);
  });

  it('caps capture length so accumulation stops near MAX_CAPTURE_SAMPLES', async () => {
    // Many small chunks so the loop can only overshoot the cap by ~one chunk.
    const chunkSize = 4000;
    const chunkCount = Math.ceil(MAX_CAPTURE_SAMPLES / chunkSize) + 20; // well past the cap
    const chunks = Array.from({ length: chunkCount }, () =>
      new Float32Array(chunkSize).fill(0.2),
    );
    // Never signals silence — only the length cap should stop the capture.
    const { io, pressSpace } = fakeIo(chunks, 'space');
    const p = captureFromMic(cfg, io);
    pressSpace();
    const frames = await p;
    expect(frames.samples.length).toBeGreaterThanOrEqual(MAX_CAPTURE_SAMPLES);
    expect(frames.samples.length).toBeLessThan(MAX_CAPTURE_SAMPLES + chunkSize);
  });
});
