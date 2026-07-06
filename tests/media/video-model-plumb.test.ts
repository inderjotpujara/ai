import { describe, expect, test } from 'bun:test';
import { ltxStrategy } from '../../src/media/generate/video-mlx.ts';

describe('ltxStrategy --model plumb', () => {
  test('emits --model when opts.model is set', () => {
    const { args } = ltxStrategy.buildOneShot!('a cat', '/tmp/out.mp4', {
      model: 'dgrauet/ltx-2.3-mlx-q4',
    });
    const i = args.indexOf('--model');
    expect(i).toBeGreaterThanOrEqual(0);
    expect(args[i + 1]).toBe('dgrauet/ltx-2.3-mlx-q4');
  });

  test('omits --model when opts.model is unset (baked-repo behavior)', () => {
    const { args } = ltxStrategy.buildOneShot!('a cat', '/tmp/out.mp4', {});
    expect(args).not.toContain('--model');
  });
});
