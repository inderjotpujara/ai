import { describe, expect, it } from 'bun:test';
import { parseMediaArgs } from '../../src/cli/chat.ts';

describe('parseMediaArgs voice flags', () => {
  it('parses --voice as a boolean', () => {
    const { positional, flags } = parseMediaArgs(['--voice']);
    expect(flags.voice).toBe(true);
    expect(positional).toEqual([]);
  });
  it('parses --voice-in as a repeatable path and keeps prompt positional', () => {
    const { positional, flags } = parseMediaArgs([
      'summarize',
      '--voice-in',
      'a.wav',
    ]);
    expect(flags.voiceIn).toEqual(['a.wav']);
    expect(positional).toEqual(['summarize']);
  });
});
