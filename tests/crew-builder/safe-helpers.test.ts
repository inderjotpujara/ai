import { expect, test } from 'bun:test';
import {
  fromInput,
  fromStep,
  fromTemplate,
  mapOver,
  whenContains,
  whenEquals,
  whenTruthy,
} from '../../src/crew-builder/safe-helpers.ts';

test('fromInput returns the ctx.input as string', () => {
  expect(fromInput()({ input: 42 })).toBe('42');
});
test('fromStep stringifies a prior step output', () => {
  expect(fromStep('a')({ a: 'hello' })).toBe('hello');
  expect(fromStep('a')({ a: { x: 1 } })).toBe('{"x":1}');
});
test('fromTemplate interpolates {{ref}} placeholders', () => {
  expect(
    fromTemplate('sum: {{a}} / in: {{input}}')({ input: 'q', a: 'A' }),
  ).toBe('sum: A / in: q');
});
test('predicates read refs from ctx', () => {
  expect(whenEquals('a', 'yes')({ a: 'yes' })).toBe(true);
  expect(whenContains('a', 'err')({ a: 'an error' })).toBe(true);
  expect(whenTruthy('a')({ a: '' })).toBe(false);
});
test('mapOver returns an array (empty when not array)', () => {
  expect(mapOver('a')({ a: [1, 2] })).toEqual([1, 2]);
  expect(mapOver('a')({ a: 'x' })).toEqual([]);
});
