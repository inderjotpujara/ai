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

// §7.3 adversarial-review regression cases — these previously LEAKED because
// the hex pattern's `\b` boundaries fail to match when the secret is glued to
// an adjacent word char, and the Bearer pattern was case-sensitive.

test('redacts an 80-hex run containing a 64-hex secret (no word boundary to anchor on)', () => {
  const hex = 'd'.repeat(64);
  const wide = 'e'.repeat(8) + hex + 'f'.repeat(8); // 80 hex chars total
  const out = redactSecrets(`blob ${wide} end`);
  expect(out).not.toContain(hex);
});

test('redacts a 64-hex secret glued to a trailing word char: key<64hex>z', () => {
  const hex = 'a1'.repeat(32);
  const out = redactSecrets(`token key${hex}z in line`);
  expect(out).not.toContain(hex);
});

test('redacts a 64-hex secret glued to a leading word char: zkey_<64hex>', () => {
  const hex = 'b2'.repeat(32);
  const out = redactSecrets(`token zkey_${hex} in line`);
  expect(out).not.toContain(hex);
});

test('redacts a lowercase "bearer" scheme (RFC 7235 case-insensitive, loggers lowercase headers)', () => {
  const out = redactSecrets('authorization: bearer opaque.session.token123');
  expect(out).not.toContain('opaque.session.token123');
});
