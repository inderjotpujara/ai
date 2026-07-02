import { describe, expect, it } from 'bun:test';
import { PassThrough } from 'node:stream';
import {
  interactiveTTY,
  stdinInput,
} from '../../src/provisioning/ui/prompt.ts';

describe('interactiveTTY', () => {
  it('is true only when both stdin and stderr are TTYs', () => {
    expect(interactiveTTY({ isTTY: true }, { isTTY: true })).toBe(true);
    expect(interactiveTTY({ isTTY: false }, { isTTY: true })).toBe(false); // stdin redirected (< /dev/null)
    expect(interactiveTTY({ isTTY: true }, { isTTY: false })).toBe(false);
    expect(interactiveTTY({}, {})).toBe(false); // isTTY undefined → false
  });
});

describe('stdinInput', () => {
  it('resolves the trimmed line on data', async () => {
    const s = new PassThrough();
    const input = stdinInput(s as unknown as NodeJS.ReadStream);
    const p = input.read();
    s.write('  yes \n');
    expect(await p).toBe('yes');
  });
  it('resolves empty string when the stream ends (never hangs)', async () => {
    const s = new PassThrough();
    const input = stdinInput(s as unknown as NodeJS.ReadStream);
    const p = input.read();
    s.end(); // e.g. stdin was `< /dev/null`
    expect(await p).toBe('');
  });
});
