import { expect, test } from 'bun:test';
import { isLoopbackHost } from '../../../src/server/security/origin.ts';

const withHost = (host: string | null) =>
  new Request('http://x/api', host === null ? {} : { headers: { host } });

test('isLoopbackHost is true for loopback hosts with or without a port', () => {
  for (const h of [
    '127.0.0.1:4130',
    '127.0.0.1',
    'localhost:4130',
    'localhost',
    '[::1]:4130',
    '[::1]',
  ]) {
    expect(isLoopbackHost(withHost(h))).toBe(true);
  }
});

test('isLoopbackHost is false for a tunnel/LAN host and an absent Host header', () => {
  expect(isLoopbackHost(withHost('ts.example'))).toBe(false);
  expect(isLoopbackHost(withHost('100.64.0.1:4130'))).toBe(false);
  expect(isLoopbackHost(withHost(null))).toBe(false);
});

// Adversarial: a subdomain-suffix spoof of a loopback host must NOT match, an
// empty Host must not match, and 0.0.0.0 (bind wildcard, never a client host)
// is not loopback.
test('isLoopbackHost rejects loopback-lookalikes, empty, and 0.0.0.0', () => {
  expect(isLoopbackHost(withHost('127.0.0.1.evil.com'))).toBe(false);
  expect(isLoopbackHost(withHost('localhost.evil.com'))).toBe(false);
  expect(isLoopbackHost(withHost('evil.com:127.0.0.1'))).toBe(false);
  expect(isLoopbackHost(withHost(''))).toBe(false);
  expect(isLoopbackHost(withHost('0.0.0.0'))).toBe(false);
  expect(isLoopbackHost(withHost('0.0.0.0:4130'))).toBe(false);
});
