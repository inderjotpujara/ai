import { expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDeviceRegistry } from '../../../src/server/security/device-registry.ts';
import { createRootTokenStore } from '../../../src/server/security/root-token.ts';
import { handleRotateRoot } from '../../../src/server/security/rotate-route.ts';
import { createSessionTokenStore } from '../../../src/server/security/session-token.ts';
import type { SessionGuard } from '../../../src/server/security/token.ts';

function ctx() {
  const dir = mkdtempSync(join(tmpdir(), 'rot-'));
  const rootTokens = createRootTokenStore({ path: join(dir, 'daemon-token') });
  const rootSecret = rootTokens.getOrCreateRoot();
  // Build the session store over a root GETTER (not the captured string), so the
  // SAME live store re-signs/re-verifies with the NEW root after rotate() — this
  // is what makes rotate-root a real invalidation instead of a no-op, and what
  // lets the re-minted local token verify while the old device token dies.
  const sessionTokens = createSessionTokenStore({
    path: join(dir, 'revoked.json'),
    rootToken: () => rootTokens.getOrCreateRoot(),
  });
  const otherToken = sessionTokens.mintSessionToken({
    deviceId: 'phone',
    ttlMs: 100_000,
  });
  const deviceRegistry = createDeviceRegistry({
    path: join(dir, 'devices.json'),
  });
  deviceRegistry.append({
    deviceId: 'phone',
    label: 'p',
    createdAt: 1,
    exp: Date.now() + 100_000,
  });
  return {
    dir,
    rootTokens,
    rootSecret,
    sessionTokens,
    otherToken,
    deviceRegistry,
    bindInfo: { sessionTtlMs: 100_000 },
    policy: { port: 4130, allowedOrigins: [], allowedHosts: [] },
  };
}

const localGuard: SessionGuard = {
  verify: () => true,
  verifyToken: () => true,
  principal: () => 'local',
};

const req = (body: unknown) =>
  new Request('http://127.0.0.1:4130/api/security/rotate-root', {
    method: 'POST',
    headers: { host: '127.0.0.1:4130', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

test('rotate invalidates OTHER sessions while re-minting a working local token', async () => {
  const c = ctx();
  const res = await handleRotateRoot(
    req({ rootSecret: c.rootSecret }),
    c,
    localGuard,
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as { token: string };
  // The OLD other-device token no longer verifies (root changed).
  const fresh = createSessionTokenStore({
    path: join(c.dir, 'revoked.json'),
    rootToken: c.rootTokens.getOrCreateRoot(),
  });
  expect(fresh.verifySessionToken(c.otherToken)).toBeNull();
  // The re-minted local token DOES verify against the NEW root.
  expect(fresh.verifySessionToken(body.token)?.deviceId).toBe('local');
  // Registry cleared (all old devices' tokens are dead).
  expect(c.deviceRegistry.list()).toEqual([]);
});

test('a wrong rootSecret is 401, root + registry untouched', async () => {
  const c = ctx();
  const res = await handleRotateRoot(
    req({ rootSecret: 'WRONG' }),
    c,
    localGuard,
  );
  expect(res.status).toBe(401);
  expect(c.rootTokens.getOrCreateRoot()).toBe(c.rootSecret); // not rotated
  expect(c.deviceRegistry.list()).toHaveLength(1); // untouched
  // The other-device token still verifies — nothing was invalidated.
  expect(c.sessionTokens.verifySessionToken(c.otherToken)?.deviceId).toBe(
    'phone',
  );
});

test('a non-local caller is 403 (before any secret check), zero side-effect', async () => {
  const c = ctx();
  const remote: SessionGuard = {
    verify: () => true,
    verifyToken: () => true,
    principal: () => 'uuid',
  };
  const res = await handleRotateRoot(
    req({ rootSecret: c.rootSecret }),
    c,
    remote,
  );
  expect(res.status).toBe(403);
  // The gate fired before rotate: root, registry, and the other session all live.
  expect(c.rootTokens.getOrCreateRoot()).toBe(c.rootSecret);
  expect(c.deviceRegistry.list()).toHaveLength(1);
  expect(c.sessionTokens.verifySessionToken(c.otherToken)?.deviceId).toBe(
    'phone',
  );
});

test('§7.1(5) idempotent-ish: a second rotate with the now-STALE old secret is 401', async () => {
  const c = ctx();
  const first = await handleRotateRoot(
    req({ rootSecret: c.rootSecret }),
    c,
    localGuard,
  );
  expect(first.status).toBe(200);
  // The old secret no longer matches the rotated root — replaying it must 401,
  // not trigger a second mass-invalidation.
  const second = await handleRotateRoot(
    req({ rootSecret: c.rootSecret }),
    c,
    localGuard,
  );
  expect(second.status).toBe(401);
});

test('malformed body (missing rootSecret) is 400 — before any rotate', async () => {
  const c = ctx();
  const res = await handleRotateRoot(req({}), c, localGuard);
  expect(res.status).toBe(400);
  expect(c.rootTokens.getOrCreateRoot()).toBe(c.rootSecret); // not rotated
  expect(c.deviceRegistry.list()).toHaveLength(1);
});

test('never leaks the root secret in the 200 body or the 401 error body', async () => {
  const c = ctx();
  const ok = await handleRotateRoot(
    req({ rootSecret: c.rootSecret }),
    c,
    localGuard,
  );
  const okBody = (await ok.json()) as Record<string, unknown>;
  // Response carries ONLY the re-minted local token — no root, no secret echo.
  expect(Object.keys(okBody)).toEqual(['token']);
  expect(JSON.stringify(okBody)).not.toContain(c.rootSecret);

  // Control: a valid rotate → 200, and its body still carries ONLY the
  // re-minted token — never an echo of the root secret it authenticated with.
  const d = ctx();
  const okAgain = await handleRotateRoot(req({ rootSecret: d.rootSecret }), d, {
    verify: () => true,
    verifyToken: () => true,
    principal: () => 'local',
  });
  expect(okAgain.status).toBe(200);
  const okAgainBody = (await okAgain.json()) as Record<string, unknown>;
  expect(Object.keys(okAgainBody)).toEqual(['token']);
  expect(JSON.stringify(okAgainBody)).not.toContain(d.rootSecret);

  // Now prove the wrong-secret error body is clean too.
  const wrong = await handleRotateRoot(
    req({ rootSecret: 'guessing-the-root' }),
    ctx(),
    localGuard,
  );
  expect(await wrong.text()).not.toContain('guessing-the-root');
});
