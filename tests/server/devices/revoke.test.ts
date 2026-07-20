import { expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleDeviceRevoke } from '../../../src/server/devices/revoke.ts';
import { createDeviceRegistry } from '../../../src/server/security/device-registry.ts';
import { createSessionTokenStore } from '../../../src/server/security/session-token.ts';
import type { SessionGuard } from '../../../src/server/security/token.ts';

function ctx() {
  const dir = mkdtempSync(join(tmpdir(), 'rev-'));
  const deviceRegistry = createDeviceRegistry({
    path: join(dir, 'devices.json'),
  });
  const sessionTokens = createSessionTokenStore({
    path: join(dir, 'revoked.json'),
    rootToken: 'r',
  });
  const token = sessionTokens.mintSessionToken({
    deviceId: 'd1',
    ttlMs: 100_000,
  });
  deviceRegistry.append({
    deviceId: 'd1',
    label: 'phone',
    createdAt: 1,
    exp: Date.now() + 100_000,
  });
  return {
    deviceRegistry,
    sessionTokens,
    token,
    policy: { port: 4130, allowedOrigins: [], allowedHosts: [] },
  };
}

const localGuard: SessionGuard = {
  verify: () => true,
  verifyToken: () => true,
  principal: () => 'local',
};
const remoteGuard: SessionGuard = {
  verify: () => true,
  verifyToken: () => true,
  principal: () => 'uuid-remote',
};
const req = new Request('http://127.0.0.1:4130/api/devices/d1/revoke', {
  method: 'POST',
  headers: { host: '127.0.0.1:4130' },
});

test('revoke prunes the registry AND stops the token verifying', () => {
  const c = ctx();
  expect(c.sessionTokens.verifySessionToken(c.token)?.deviceId).toBe('d1'); // valid before
  const res = handleDeviceRevoke('d1', req, c, localGuard);
  expect(res.status).toBe(200);
  expect(c.deviceRegistry.list().map((d) => d.deviceId)).toEqual([]); // pruned
  expect(c.sessionTokens.verifySessionToken(c.token)).toBeNull(); // token dead
});

test('a non-local caller is 403', () => {
  expect(handleDeviceRevoke('d1', req, ctx(), remoteGuard).status).toBe(403);
});

test('403 has ZERO side effect — nothing revoked, nothing pruned', () => {
  // Security bar #1: a rejected caller must leave the registry AND the negative
  // revocation set completely untouched (both failure surfaces asserted).
  const c = ctx();
  const res = handleDeviceRevoke('d1', req, c, remoteGuard);
  expect(res.status).toBe(403);
  // (a) still listed in the positive registry
  expect(c.deviceRegistry.list().map((d) => d.deviceId)).toEqual(['d1']);
  // (b) its token still verifies — NOT added to the negative set
  expect(c.sessionTokens.verifySessionToken(c.token)?.deviceId).toBe('d1');
});

test('403 for a non-loopback Host has ZERO side effect', () => {
  // The other trusted-local failure mode: a 'local' principal arriving over a
  // NON-loopback (tunnel) Host is still 403 with no state change.
  const c = ctx();
  const tunnelReq = new Request('http://agent.ts.net/api/devices/d1/revoke', {
    method: 'POST',
    headers: { host: 'agent.ts.net' },
  });
  const res = handleDeviceRevoke('d1', tunnelReq, c, localGuard);
  expect(res.status).toBe(403);
  expect(c.deviceRegistry.list().map((d) => d.deviceId)).toEqual(['d1']);
  expect(c.sessionTokens.verifySessionToken(c.token)?.deviceId).toBe('d1');
});

test('revoking an unknown id is idempotent and leaves other devices intact', () => {
  // Security bar #3: unknown id → safe 200 (idempotent semantics), no crash,
  // and d1 is completely unaffected (still listed, token still verifies).
  const c = ctx();
  const res = handleDeviceRevoke('does-not-exist', req, c, localGuard);
  expect(res.status).toBe(200);
  expect(c.deviceRegistry.list().map((d) => d.deviceId)).toEqual(['d1']);
  expect(c.sessionTokens.verifySessionToken(c.token)?.deviceId).toBe('d1');
});

test('revoking the same id twice is idempotent (no crash, stays revoked)', () => {
  const c = ctx();
  expect(handleDeviceRevoke('d1', req, c, localGuard).status).toBe(200);
  const second = handleDeviceRevoke('d1', req, c, localGuard);
  expect(second.status).toBe(200);
  expect(c.deviceRegistry.list().map((d) => d.deviceId)).toEqual([]);
  expect(c.sessionTokens.verifySessionToken(c.token)).toBeNull();
});

test('a traversal-shaped id cannot escape — it is a plain opaque set key', () => {
  // Security bar #4: the id is a plain path segment used only as a Set key /
  // registry filter value — it never touches the filesystem, so a traversal
  // string affects nothing but its own (nonexistent) entry.
  const c = ctx();
  const res = handleDeviceRevoke('../../etc/passwd', req, c, localGuard);
  expect(res.status).toBe(200);
  // d1 untouched by the forged id.
  expect(c.deviceRegistry.list().map((d) => d.deviceId)).toEqual(['d1']);
  expect(c.sessionTokens.verifySessionToken(c.token)?.deviceId).toBe('d1');
});

test("self-revoke of 'local' is rejected with 400 (sacrosanct id)", () => {
  // 'local' is sacrosanct: pairing never mints it, and revoke must not remove
  // it either. The trusted-local gate runs FIRST (so a remote/tunnel caller
  // still gets 403, not this 400), but a trusted local caller revoking
  // 'local' now gets a 400 instead of locking itself out.
  const c = ctx();
  const localToken = c.sessionTokens.mintSessionToken({
    deviceId: 'local',
    ttlMs: 100_000,
  });
  expect(c.sessionTokens.verifySessionToken(localToken)?.deviceId).toBe(
    'local',
  );
  const res = handleDeviceRevoke('local', req, c, localGuard);
  expect(res.status).toBe(400);
  expect(res.json()).resolves.toEqual({
    error: 'cannot revoke the local session',
  });
  // 'local' still verifies — NOT added to the negative set.
  expect(c.sessionTokens.verifySessionToken(localToken)?.deviceId).toBe(
    'local',
  );
  // Other devices (d1) are unaffected.
  expect(c.sessionTokens.verifySessionToken(c.token)?.deviceId).toBe('d1');
});
