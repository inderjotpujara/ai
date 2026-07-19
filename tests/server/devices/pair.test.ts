import { expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleDeviceList } from '../../../src/server/devices/list.ts';
import { handleDevicePair } from '../../../src/server/devices/pair.ts';
import { createDeviceRegistry } from '../../../src/server/security/device-registry.ts';
import { createSessionTokenStore } from '../../../src/server/security/session-token.ts';
import type { SessionGuard } from '../../../src/server/security/token.ts';

type PairBody = { deviceId: string; token: string; pairingUrl: string };
const pairBody = (res: Response): Promise<PairBody> =>
  res.json() as Promise<PairBody>;

function deps() {
  const dir = mkdtempSync(join(tmpdir(), 'pair-'));
  const deviceRegistry = createDeviceRegistry({
    path: join(dir, 'devices.json'),
  });
  const sessionTokens = createSessionTokenStore({
    path: join(dir, 'revoked.json'),
    rootToken: 'root-secret',
  });
  return {
    deviceRegistry,
    sessionTokens,
    publicBaseUrl: 'http://ts.example',
    bindInfo: {
      bind: '127.0.0.1',
      allowedHosts: [],
      port: 4130,
      sessionTtlMs: 100_000,
    },
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
const req = (body: unknown) =>
  new Request('http://127.0.0.1:4130/api/devices', {
    method: 'POST',
    headers: { host: '127.0.0.1:4130', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

test('pair mints a server-side id, returns the token once, appends to registry', async () => {
  const d = deps();
  const res = await handleDevicePair(req({ label: 'phone' }), d, localGuard);
  expect(res.status).toBe(202);
  const body = await pairBody(res);
  expect(body.deviceId).toMatch(/^[0-9a-f-]{36}$/); // server-minted UUID
  expect(body.token.length).toBeGreaterThan(10);
  expect(body.pairingUrl).toBe(`http://ts.example/#token=${body.token}`);
  // Registry has the device but NEVER the token.
  const listed = d.deviceRegistry.list();
  expect(listed.map((x) => x.deviceId)).toEqual([body.deviceId]);
  expect(JSON.stringify(listed)).not.toContain(body.token);
  // The minted token actually authenticates (verifies against the store).
  expect(d.sessionTokens.verifySessionToken(body.token)?.deviceId).toBe(
    body.deviceId,
  );
});

test('IDOR: a client-supplied deviceId in the body is IGNORED (server mints)', async () => {
  const d = deps();
  const res = await handleDevicePair(
    req({ label: 'x', deviceId: 'local' }),
    d,
    localGuard,
  );
  const body = await pairBody(res);
  expect(body.deviceId).not.toBe('local'); // never honours the injected id
  expect(body.deviceId).toMatch(/^[0-9a-f-]{36}$/); // a fresh random UUID
  // And the injected 'local' id is nowhere in the registry either.
  expect(d.deviceRegistry.list().map((x) => x.deviceId)).toEqual([
    body.deviceId,
  ]);
});

test('a non-local principal is 403 (trusted-local gate) with NO side effect', async () => {
  const d = deps();
  const res = await handleDevicePair(req({ label: 'x' }), d, remoteGuard);
  expect(res.status).toBe(403);
  // Nothing minted or appended on a rejected pair.
  expect(d.deviceRegistry.list()).toEqual([]);
});

test('a non-loopback / tunnel Host is 403 even for a local principal, NO side effect', async () => {
  const d = deps();
  const tunnelReq = new Request('http://box.ts.net/api/devices', {
    method: 'POST',
    headers: { host: 'box.ts.net', 'content-type': 'application/json' },
    body: JSON.stringify({ label: 'x' }),
  });
  const res = await handleDevicePair(tunnelReq, d, localGuard);
  expect(res.status).toBe(403);
  expect(d.deviceRegistry.list()).toEqual([]);
});

test('the minted token NEVER appears in a subsequent GET /api/devices', async () => {
  const d = deps();
  const res = await handleDevicePair(req({ label: 'phone' }), d, localGuard);
  const { token } = await pairBody(res);
  const listRes = handleDeviceList({ deviceRegistry: d.deviceRegistry });
  const listBody = await listRes.text();
  expect(listBody).not.toContain(token);
});

test('pairingUrl carries the token in the # fragment, NOT the query string', async () => {
  const d = deps();
  const res = await handleDevicePair(req({ label: 'phone' }), d, localGuard);
  const { token, pairingUrl } = await pairBody(res);
  const url = new URL(pairingUrl);
  expect(url.search).toBe(''); // no ?query at all
  expect(url.searchParams.has('token')).toBe(false);
  expect(url.hash).toBe(`#token=${token}`); // token is in the fragment
});

test('a bad body is 400', async () => {
  const res = await handleDevicePair(req({ label: '' }), deps(), localGuard);
  expect(res.status).toBe(400);
});
