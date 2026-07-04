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
test('asStr-backed helpers never throw on hostile ctx values', () => {
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  expect(() => fromStep('a')({ a: circular })).not.toThrow();
  expect(typeof fromStep('a')({ a: circular })).toBe('string');
  expect(fromStep('a')({ a: 10n })).toBe('10'); // bigint
  expect(fromStep('a')({ a: () => 1 })).toBe(''); // function
  expect(fromStep('a')({ a: Symbol('x') })).toBe(''); // symbol
  expect(whenContains('a', 'x')({ a: () => 1 })).toBe(false); // must not throw
  expect(whenTruthy('a')({ a: () => 1 })).toBe(false); // function -> asStr '' -> length 0 -> false
  expect(fromTemplate('{{a}}')({ a: 10n })).toBe('10');
});
