import { expect, test } from 'bun:test';
import { redactSecrets } from '../../../src/server/daemon/redact.ts';

test('redacts a 64-hex token', () => {
  const hex = 'a'.repeat(64);
  const out = redactSecrets(`booted with root ${hex} ok`);
  expect(out).not.toContain(hex);
  expect(out).toContain('‹redacted›');
});

test('redacts a Bearer session token', () => {
  const out = redactSecrets('auth: Bearer eyJhbGciOi.payload.sig extra');
  expect(out).not.toContain('eyJhbGciOi.payload.sig');
  expect(out).toContain('Bearer ‹redacted›');
});

test('leaves a clean line untouched', () => {
  expect(redactSecrets('run-123 finished ok')).toBe('run-123 finished ok');
});

test('redacts every occurrence on a line with multiple secrets (global, not first-only)', () => {
  const hexA = 'a'.repeat(64);
  const hexB = 'b'.repeat(64);
  const out = redactSecrets(`root ${hexA} and again ${hexB} done`);
  expect(out).not.toContain(hexA);
  expect(out).not.toContain(hexB);
  expect(out.split('‹redacted›').length - 1).toBe(2);
});

test('redacts a 64-hex token even when it trails a Bearer prefix', () => {
  const hex = 'c'.repeat(64);
  const out = redactSecrets(`auth: Bearer ${hex} tail`);
  expect(out).not.toContain(hex);
  expect(out).toContain('Bearer ‹redacted›');
});
