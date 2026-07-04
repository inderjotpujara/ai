import { expect, test } from 'bun:test';
import { cosine, embedOne } from '../../src/memory/embed-one.ts';

test('embedOne embeds a single text via the batch embed fn', async () => {
  const fake = async (_t: string[]): Promise<number[][]> => [[1, 0, 0]];
  await expect(embedOne('x', fake)).resolves.toEqual([1, 0, 0]);
});

test('cosine of identical vectors is ~1', () => {
  expect(cosine([1, 0], [1, 0])).toBeCloseTo(1);
});

test('cosine of orthogonal vectors is ~0', () => {
  expect(cosine([1, 0], [0, 1])).toBeCloseTo(0);
});
