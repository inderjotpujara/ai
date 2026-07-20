import { expect, test } from 'bun:test';
import { substituteTemplate } from '../../src/triggers/substitute.ts';

test('substitutes {{file.path}} in nested string values only', () => {
  const out = substituteTemplate(
    { task: 'process {{file.path}}', n: 3, nested: { p: '{{file.path}}' } },
    { 'file.path': '/data/x.csv' },
  );
  expect(out).toEqual({
    task: 'process /data/x.csv',
    n: 3,
    nested: { p: '/data/x.csv' },
  });
});

test('unknown placeholders are left literal (never evaluated)', () => {
  expect(substituteTemplate({ a: '{{secret}}' }, {})).toEqual({
    a: '{{secret}}',
  });
});

test('substitutes inside array elements and leaves non-string leaves untouched', () => {
  const out = substituteTemplate(
    { items: ['{{webhook.body}}', 42, true, null] },
    { 'webhook.body': 'payload' },
  );
  expect(out).toEqual({ items: ['payload', 42, true, null] });
});

test('multiple placeholders in one string and whitespace inside braces', () => {
  const out = substituteTemplate('{{ a }} and {{b}}', { a: '1', b: '2' });
  expect(out).toBe('1 and 2');
});

test('plain string interpolation only — no expression is ever evaluated', () => {
  // A placeholder key that looks like code stays literal unless present in vars.
  const out = substituteTemplate(
    { cmd: '{{process.exit(1)}}', ok: '{{x}}' },
    { x: 'y' },
  );
  expect(out).toEqual({ cmd: '{{process.exit(1)}}', ok: 'y' });
});
