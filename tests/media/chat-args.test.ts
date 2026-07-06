import { expect, test } from 'bun:test';
import { parseMediaArgs } from '../../src/cli/chat.ts';

test('parses repeatable media flags and leaves positional intact', () => {
  const { positional, flags } = parseMediaArgs([
    'describe',
    'these',
    '--image',
    'a.png',
    '--image',
    'b.png',
    '--paste',
  ]);
  expect(positional).toEqual(['describe', 'these']);
  expect(flags.images).toEqual(['a.png', 'b.png']);
  expect(flags.paste).toBe(true);
});

test('parses --audio and --video flags', () => {
  const { positional, flags } = parseMediaArgs([
    'transcribe',
    '--audio',
    'a.wav',
    '--video',
    'b.mp4',
  ]);
  expect(positional).toEqual(['transcribe']);
  expect(flags.audios).toEqual(['a.wav']);
  expect(flags.videos).toEqual(['b.mp4']);
  expect(flags.paste).toBe(false);
});

test('returns empty flags for plain positional args', () => {
  const { positional, flags } = parseMediaArgs(['just', 'a', 'question']);
  expect(positional).toEqual(['just', 'a', 'question']);
  expect(flags).toEqual({ images: [], audios: [], videos: [], paste: false });
});

test('drops a trailing value-taking flag with no value', () => {
  const { positional, flags } = parseMediaArgs(['hi', '--image']);
  expect(positional).toEqual(['hi']);
  expect(flags.images).toEqual([]);
});
