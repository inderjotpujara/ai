import { describe, expect, it, vi } from 'vitest';
import { createInterimAccumulator, detectWebGpuDevice } from './stt.worker.ts';

// The rest of stt.worker.ts (model load/inference) is real transformers.js/
// ONNX work that cannot run under happy-dom — see the header comment in
// stt.worker.ts and Task 7's report. `detectWebGpuDevice` is the one piece
// of pure, browser-capability-detection logic pulled out of that file, so
// it's the one thing worth unit-testing here; live-verify (Task 17/18)
// covers the model path for real.
describe('detectWebGpuDevice', () => {
  it('falls back to wasm when navigator.gpu is absent', async () => {
    vi.stubGlobal('navigator', {});
    await expect(detectWebGpuDevice()).resolves.toBe('wasm');
  });

  it('resolves webgpu when an adapter is available', async () => {
    vi.stubGlobal('navigator', {
      gpu: { requestAdapter: vi.fn().mockResolvedValue({}) },
    });
    await expect(detectWebGpuDevice()).resolves.toBe('webgpu');
  });

  it('falls back to wasm when requestAdapter resolves null (no adapter)', async () => {
    vi.stubGlobal('navigator', {
      gpu: { requestAdapter: vi.fn().mockResolvedValue(null) },
    });
    await expect(detectWebGpuDevice()).resolves.toBe('wasm');
  });

  it('falls back to wasm when requestAdapter rejects (D9: never crash)', async () => {
    vi.stubGlobal('navigator', {
      gpu: { requestAdapter: vi.fn().mockRejectedValue(new Error('boom')) },
    });
    await expect(detectWebGpuDevice()).resolves.toBe('wasm');
  });
});

// The pure accumulation logic behind the new `transcribeInterim` response
// variant (D6) — isolated exactly like `detectWebGpuDevice` above, because
// `TextStreamer`'s `callback_function` only ever hands back the newly
// finalized DELTA substring per call (see `streamers.js`'s
// `on_finalized_text`); everything downstream of a real streamer wired to a
// real `generate()` call is live-verify-only, same as the rest of this file.
describe('createInterimAccumulator', () => {
  it('accumulates incremental TextStreamer chunks into the full running text (never a delta)', () => {
    const acc = createInterimAccumulator();
    expect(acc.push('Hello ')).toBe('Hello ');
    expect(acc.push('world')).toBe('Hello world');
    expect(acc.push('!')).toBe('Hello world!');
  });

  it('starts empty and handles an immediate empty-string chunk without changing the running text', () => {
    const acc = createInterimAccumulator();
    expect(acc.push('')).toBe('');
    expect(acc.push('ok')).toBe('ok');
  });
});
