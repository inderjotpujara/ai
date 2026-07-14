import { expect, test } from 'bun:test';
import {
  type OriginPolicy,
  enforcePerimeter,
  hostAllowed,
  originAllowed,
} from '../../src/server/security/origin.ts';

const policy: OriginPolicy = { port: 4130, allowedOrigins: ['http://localhost', 'http://127.0.0.1'] };

const req = (headers: Record<string, string>) =>
  new Request('http://localhost:4130/api/health', { headers });

test('accepts a localhost/127.0.0.1 Host on the configured port', () => {
  expect(hostAllowed(req({ host: 'localhost:4130' }), 4130)).toBe(true);
  expect(hostAllowed(req({ host: '127.0.0.1:4130' }), 4130)).toBe(true);
});

test('rejects a rebinding Host (attacker domain) and a missing Host', () => {
  expect(hostAllowed(req({ host: 'evil.example.com:4130' }), 4130)).toBe(false);
  expect(hostAllowed(new Request('http://localhost:4130/x'), 4130)).toBe(false);
});

test('allows an absent Origin (same-origin nav) and a listed origin; rejects cross-origin', () => {
  expect(originAllowed(req({ host: 'localhost:4130' }), policy)).toBe(true);
  expect(originAllowed(req({ host: 'localhost:4130', origin: 'http://localhost:4130' }), policy)).toBe(true);
  expect(originAllowed(req({ host: 'localhost:4130', origin: 'https://evil.example.com' }), policy)).toBe(false);
});

test('enforcePerimeter returns 403 on a bad host, null when clean', () => {
  const bad = enforcePerimeter(req({ host: 'evil.example.com:4130' }), policy);
  expect(bad?.status).toBe(403);
  expect(enforcePerimeter(req({ host: 'localhost:4130' }), policy)).toBeNull();
});
