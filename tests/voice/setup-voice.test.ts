import { describe, expect, it } from 'bun:test';
import { isModelReady, modelUrl } from '../../scripts/setup-voice.ts';

describe('setup-voice helpers', () => {
  it('builds the asr-models release URL for a model name', () => {
    expect(modelUrl('sherpa-onnx-moonshine-tiny-en-int8')).toBe(
      'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-moonshine-tiny-en-int8.tar.bz2',
    );
  });
  it('is ready only when the tokens marker file exists', () => {
    const dir = '/m/tiny';
    expect(isModelReady(dir, (p) => p === '/m/tiny/tokens.txt')).toBe(true);
    expect(isModelReady(dir, () => false)).toBe(false);
  });
});
