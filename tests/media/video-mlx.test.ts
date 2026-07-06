import { expect, test } from 'bun:test';
import { ltxStrategy } from '../../src/media/generate/video-mlx.ts';
import { ExecMode, MediaKind } from '../../src/media/types.ts';

test('ltxStrategy has correct kind and execMode', () => {
  expect(ltxStrategy.kind).toBe(MediaKind.Video);
  expect(ltxStrategy.execMode).toBe(ExecMode.OneShot);
});

test('buildOneShot includes --prompt with the prompt', () => {
  const result = ltxStrategy.buildOneShot?.(
    'a cat dancing',
    '/tmp/out.mp4',
    {},
  );
  expect(result).toBeDefined();
  if (result) {
    expect(result.args).toContain('--prompt');
    const promptIdx = result.args.indexOf('--prompt');
    expect(result.args[promptIdx + 1]).toBe('a cat dancing');
  }
});

test('buildOneShot includes --output-path with outPath', () => {
  const result = ltxStrategy.buildOneShot?.('prompt', '/tmp/output.mp4', {});
  expect(result).toBeDefined();
  if (result) {
    expect(result.args).toContain('--output-path');
    const pathIdx = result.args.indexOf('--output-path');
    expect(result.args[pathIdx + 1]).toBe('/tmp/output.mp4');
  }
});

test('buildOneShot --num-frames defaults to 97 frames', () => {
  const result = ltxStrategy.buildOneShot?.('prompt', '/tmp/out.mp4', {});
  expect(result).toBeDefined();
  if (result) {
    expect(result.args).toContain('--num-frames');
    const nIdx = result.args.indexOf('--num-frames');
    expect(result.args[nIdx + 1]).toBe('97');
  }
});

test('buildOneShot --num-frames computes frames from seconds (24 fps)', () => {
  const result = ltxStrategy.buildOneShot?.('prompt', '/tmp/out.mp4', {
    seconds: 2,
  });
  expect(result).toBeDefined();
  if (result) {
    expect(result.args).toContain('--num-frames');
    const nIdx = result.args.indexOf('--num-frames');
    expect(result.args[nIdx + 1]).toBe('48'); // 2 * 24 = 48
  }
});

test('buildOneShot --width defaults to 768', () => {
  const result = ltxStrategy.buildOneShot?.('prompt', '/tmp/out.mp4', {});
  expect(result).toBeDefined();
  if (result) {
    expect(result.args).toContain('--width');
    const widthIdx = result.args.indexOf('--width');
    expect(result.args[widthIdx + 1]).toBe('768');
  }
});

test('buildOneShot --width uses provided value', () => {
  const result = ltxStrategy.buildOneShot?.('prompt', '/tmp/out.mp4', {
    width: 512,
  });
  expect(result).toBeDefined();
  if (result) {
    expect(result.args).toContain('--width');
    const widthIdx = result.args.indexOf('--width');
    expect(result.args[widthIdx + 1]).toBe('512');
  }
});

test('buildOneShot includes --image when provided', () => {
  const result = ltxStrategy.buildOneShot?.('prompt', '/tmp/out.mp4', {
    image: '/path/to/image.png',
  });
  expect(result).toBeDefined();
  if (result) {
    expect(result.args).toContain('--image');
    const imgIdx = result.args.indexOf('--image');
    expect(result.args[imgIdx + 1]).toBe('/path/to/image.png');
  }
});

test('buildOneShot does not include --image when not provided', () => {
  const result = ltxStrategy.buildOneShot?.('prompt', '/tmp/out.mp4', {});
  expect(result).toBeDefined();
  if (result) {
    expect(result.args).not.toContain('--image');
  }
});

test('buildOneShot cmd uses AGENT_VIDEO_CMD env var when set', () => {
  const oldEnv = process.env.AGENT_VIDEO_CMD;
  process.env.AGENT_VIDEO_CMD = 'custom_video_cmd';
  try {
    const result = ltxStrategy.buildOneShot?.('prompt', '/tmp/out.mp4', {});
    expect(result?.cmd).toBe('custom_video_cmd');
  } finally {
    if (oldEnv === undefined) {
      delete process.env.AGENT_VIDEO_CMD;
    } else {
      process.env.AGENT_VIDEO_CMD = oldEnv;
    }
  }
});

test('buildOneShot cmd defaults to mlx_video.ltx_2.generate', () => {
  const oldEnv = process.env.AGENT_VIDEO_CMD;
  delete process.env.AGENT_VIDEO_CMD;
  try {
    const result = ltxStrategy.buildOneShot?.('prompt', '/tmp/out.mp4', {});
    expect(result?.cmd).toBe('mlx_video.ltx_2.generate');
  } finally {
    if (oldEnv !== undefined) {
      process.env.AGENT_VIDEO_CMD = oldEnv;
    }
  }
});

test('parseProgress parses step N/M pattern', () => {
  const progress = ltxStrategy.parseProgress?.('step 12/50');
  expect(progress).toBeDefined();
  expect(progress?.fraction).toBeCloseTo(0.24, 5);
  expect(progress?.message).toBe('step 12/50');
});

test('parseProgress returns undefined for non-matching lines', () => {
  expect(ltxStrategy.parseProgress?.('no match here')).toBeUndefined();
  expect(ltxStrategy.parseProgress?.('generating...')).toBeUndefined();
  expect(ltxStrategy.parseProgress?.('step 1')).toBeUndefined();
});

test('parseProgress guards against a step 0/0 line (divide-by-zero -> NaN)', () => {
  expect(ltxStrategy.parseProgress?.('step 0/0')).toBeUndefined();
});

test('parseProgress handles various step patterns', () => {
  const cases = [
    { input: 'step 1/100', expected: 0.01 },
    { input: 'step 50/100', expected: 0.5 },
    { input: 'step 100/100', expected: 1.0 },
    { input: 'step 5/10', expected: 0.5 },
  ];

  for (const { input, expected } of cases) {
    const progress = ltxStrategy.parseProgress?.(input);
    expect(progress).toBeDefined();
    expect(progress?.fraction).toBeCloseTo(expected, 5);
  }
});
