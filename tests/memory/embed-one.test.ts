import { expect, test } from 'bun:test';
import { CosineDimensionError } from '../../src/memory/chunk.ts';
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

test('cosine throws CosineDimensionError on mismatched lengths', () => {
  expect(() => cosine([1, 0, 0], [1, 0])).toThrow(CosineDimensionError);
  expect(() => cosine([1, 0, 0], [1, 0])).toThrow(
    'incomparable vectors (length 3 vs 2)',
  );
});

test('cosine throws CosineDimensionError on empty vectors', () => {
  expect(() => cosine([], [])).toThrow(CosineDimensionError);
  expect(() => cosine([1], [])).toThrow(CosineDimensionError);
  expect(() => cosine([], [1])).toThrow(CosineDimensionError);
});
