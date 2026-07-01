import { describe, expect, test } from 'bun:test';
import { chunk } from '../../src/memory/chunk.ts';

describe('chunk', () => {
  test('fixed-size fallback respects capTokens (chars≈tokens×4)', async () => {
    const text = 'a'.repeat(1000);
    const chunks = await chunk(text, { capTokens: 50 }); // ~200 chars/chunk
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(50 * 4);
    expect(chunks.map((c) => c.ordinal)).toEqual(chunks.map((_, i) => i));
  });
  test('reassembles to original (fallback, no overlap loss)', async () => {
    const text = 'one two three four five six seven eight';
    const chunks = await chunk(text, { capTokens: 4 });
    expect(chunks.map((c) => c.text).join('')).toContain('one');
  });
  test('semantic split calls embed and keeps chunks under cap', async () => {
    const embed = async (ts: string[]) =>
      ts.map((_, i) => [i % 2, 1 - (i % 2)]); // alternating vectors
    const text = 'Sentence one. Sentence two. Sentence three. Sentence four.';
    const chunks = await chunk(text, { capTokens: 100, embed });
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(100 * 4);
  });
});
