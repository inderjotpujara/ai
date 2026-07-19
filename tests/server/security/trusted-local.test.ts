import { expect, test } from 'bun:test';
import type { SessionGuard } from '../../../src/server/security/token.ts';
import { requireTrustedLocal } from '../../../src/server/security/trusted-local.ts';

// A TUNNEL host that IS on the perimeter allowlist (so it passes hostAllowed /
// enforcePerimeter) but is NOT loopback — the injected-'local'-token replay
// vector requireTrustedLocal must now close.
const policy = { port: 4130, allowedOrigins: [], allowedHosts: ['ts.example'] };
const localReq = new Request('http://127.0.0.1:4130/api/devices', {
  method: 'POST',
  headers: { host: '127.0.0.1:4130' },
});
const remoteHostReq = new Request('http://evil.example/api/devices', {
  method: 'POST',
  headers: { host: 'evil.example' },
});
const tunnelReq = new Request('http://ts.example/api/devices', {
  method: 'POST',
  headers: { host: 'ts.example' },
});

function guardWith(principal: string | undefined): SessionGuard {
  return {
    verify: () => true,
    verifyToken: () => true,
    principal: () => principal,
  };
}

test('passes for the local principal from a loopback host', () => {
  expect(requireTrustedLocal(localReq, guardWith('local'), policy)).toBeNull();
});

test('403 when the principal is a paired remote device (UUID, not "local")', () => {
  const res = requireTrustedLocal(
    localReq,
    guardWith('550e8400-e29b-41d4-a716-446655440000'),
    policy,
  );
  expect(res?.status).toBe(403);
});

test('403 when the Host is a non-loopback, non-allowlisted remote', () => {
  const res = requireTrustedLocal(remoteHostReq, guardWith('local'), policy);
  expect(res?.status).toBe(403);
});

test('403 when the injected "local" token is replayed over an ALLOWED TUNNEL host (not loopback)', () => {
  // The core FIX-2 backstop: even the trusted-'local' principal is rejected
  // unless the Host is loopback — an allowlisted tunnel host is not enough.
  const res = requireTrustedLocal(tunnelReq, guardWith('local'), policy);
  expect(res?.status).toBe(403);
});

test('403 when there is no verified principal at all', () => {
  expect(
    requireTrustedLocal(localReq, guardWith(undefined), policy)?.status,
  ).toBe(403);
});

// A cross-origin Origin header on an otherwise loopback+local request must
// still fail the third condition (originAllowed).
test('403 when a loopback local request carries a cross-origin Origin header', () => {
  const crossOriginReq = new Request('http://127.0.0.1:4130/api/devices', {
    method: 'POST',
    headers: { host: '127.0.0.1:4130', origin: 'http://evil.example' },
  });
  const res = requireTrustedLocal(crossOriginReq, guardWith('local'), policy);
  expect(res?.status).toBe(403);
});
