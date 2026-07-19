import { expect, test } from 'bun:test';
import {
  createTokenGuard,
  mintSessionToken,
} from '../../src/server/security/token.ts';

const withAuth = (value: string) =>
  new Request('http://localhost:4130/api/health', {
    headers: { authorization: value },
  });

test('mintSessionToken returns a 64-char hex string, unique per call', () => {
  const a = mintSessionToken();
  const b = mintSessionToken();
  expect(a).toMatch(/^[0-9a-f]{64}$/);
  expect(a).not.toBe(b);
});

test('guard accepts the exact bearer token', () => {
  const token = mintSessionToken();
  expect(createTokenGuard(token).verify(withAuth(`Bearer ${token}`))).toBe(
    true,
  );
});

test('guard rejects a wrong, missing, or non-bearer token', () => {
  const guard = createTokenGuard(mintSessionToken());
  expect(guard.verify(withAuth(`Bearer ${mintSessionToken()}`))).toBe(false);
  expect(guard.verify(withAuth('deadbeef'))).toBe(false);
  expect(guard.verify(new Request('http://localhost:4130/api/health'))).toBe(
    false,
  );
});

test('verifyToken accepts the raw token from the sendBeacon BODY (constant-time), rejects a wrong one', () => {
  const guard = createTokenGuard('sekret');
  expect(guard.verifyToken('sekret')).toBe(true);
  expect(guard.verifyToken('wrong')).toBe(false);
  expect(guard.verifyToken('')).toBe(false);
});
