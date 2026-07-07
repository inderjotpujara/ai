import { describe, expect, it } from 'bun:test';
import {
  captureFromMic,
  MAX_CAPTURE_SAMPLES,
} from '../../src/voice/capture.ts';
import { VoiceError } from '../../src/voice/types.ts';

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
    pressKey: (k: 'space' | 'enter' | 'ctrl-c') => keyCb(k),
  };
}

/**
 * A "live" mic session whose frame stream only ends once `stop()` is called —
 * unlike `fakeIo`'s finite generator, this simulates a real ffmpeg pipe that
 * keeps the iterator open until the process is killed, so a manual
 * second-space/enter is what actually concludes the capture.
 */
function liveFakeIo(chunks: Float32Array[]) {
  let keyCb: (k: string) => void = () => {};
  let resolveStopped: () => void = () => {};
  const stopped = new Promise<void>((res) => {
    resolveStopped = res;
  });
  return {
    io: {
      async start() {
        return {
          frames: (async function* () {
            for (const c of chunks) yield c;
            await stopped; // block until stop() is called, then end the iteration
          })(),
          silenceSignaled: new Promise<void>(() => {}), // never auto-stops
          async stop() {
            resolveStopped();
          },
        };
      },
      onKey(cb: (k: 'space' | 'enter' | 'ctrl-c') => void) {
        keyCb = cb as (k: string) => void;
        return () => {};
      },
      print() {},
    },
    pressKey: (k: 'space' | 'enter' | 'ctrl-c') => keyCb(k),
  };
}

/** A mic session whose frame stream throws mid-iteration (e.g. device dropped). */
function throwingFakeIo(firstChunk: Float32Array, errorMessage: string) {
  let keyCb: (k: string) => void = () => {};
  return {
    io: {
      async start() {
        return {
          frames: (async function* () {
            yield firstChunk;
            throw new Error(errorMessage);
          })(),
          silenceSignaled: new Promise<void>(() => {}),
          async stop() {},
        };
      },
      onKey(cb: (k: 'space' | 'enter' | 'ctrl-c') => void) {
        keyCb = cb as (k: string) => void;
        return () => {};
      },
      print() {},
    },
    pressKey: (k: 'space' | 'enter' | 'ctrl-c') => keyCb(k),
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

  it('ctrl-c cancels the capture with a VoiceError', async () => {
    const { io, pressKey } = fakeIo(
      [new Float32Array(800).fill(0.2)],
      'space',
    );
    const p = captureFromMic(cfg, io);
    pressKey('ctrl-c');
    await expect(p).rejects.toThrow(VoiceError);
    await expect(p).rejects.toThrow(/cancelled/i);
  });

  it('a manual second space stops capture and returns the accumulated samples', async () => {
    const { io, pressKey } = liveFakeIo([new Float32Array(800).fill(0.2)]);
    const p = captureFromMic(cfg, io);
    pressKey('space'); // begin recording
    await Promise.resolve(); // let io.start()/pumpFrames start draining the live stream
    pressKey('space'); // manual stop — nothing else would ever end this capture
    const frames = await p;
    expect(frames.samples.length).toBe(800);
  });

  it('surfaces the real error (not the mic-permission hint) when the frame stream throws mid-iteration', async () => {
    const { io, pressKey } = throwingFakeIo(
      new Float32Array(800).fill(0.2),
      'device disconnected',
    );
    const p = captureFromMic(cfg, io);
    pressKey('space');
    await expect(p).rejects.toThrow(VoiceError);
    try {
      await p;
      throw new Error('expected captureFromMic to reject');
    } catch (err) {
      const voiceErr = err as VoiceError;
      expect(voiceErr.hint).toContain('device disconnected');
      expect(voiceErr.hint).not.toMatch(/grant Microphone access/i);
    }
  });
});
