import { expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startWebServer } from '../../../src/server/main.ts';
import { createRootTokenStore } from '../../../src/server/security/root-token.ts';
import { createSessionTokenStore } from '../../../src/server/security/session-token.ts';

/**
 * §7.1 SECURITY ACCEPTANCE SUITE (Slice 25b, Increment 3) — the net that proves
 * the whole device-pairing / revoke / rotate-root perimeter holds END-TO-END.
 *
 * Every case here boots a REAL standalone `startWebServer` over temp dirs and
 * drives it with raw `fetch` (real perimeter, real durable session guard, real
 * device registry + root store), so the assertions exercise the SAME code path
 * a phone or a tunnel client hits — not a hand-built ctx(). The per-route unit
 * tests (`tests/server/{devices,security}/*.test.ts`) already prove each handler
 * in isolation; this suite proves they compose into one coherent threat model.
 *
 * Two fixture invariants make the hardest cases real (per the T20 wiring):
 *  - The injected `sessionTokens` is built over a root GETTER that reads the
 *    SAME injected `rootTokens`, and that SAME `rootTokens` is handed to
 *    `startWebServer` (→ `deps.rootTokens`). So a rotate-root re-signs/verifies
 *    with the NEW root — real mass-invalidation, not a silent no-op.
 *  - `allowedHosts: [TUNNEL_HOST]` lets a non-loopback Host clear the DNS-
 *    rebinding perimeter and actually REACH `requireTrustedLocal`, so the
 *    CRITICAL-2 case is rejected on the loopback-Host requirement (403) rather
 *    than bouncing at the perimeter for the wrong reason.
 */

const TUNNEL_HOST = 'ts.example';
const UUID_RE = /^[0-9a-f-]{36}$/;

type OpsServer = {
  port: number;
  base: string;
  localToken: string;
  rootSecret: string;
  stop: () => Promise<void>;
};

/** Boot a real, hermetic ops server with the injected security core wired so the
 *  rotate/revoke cases operate on the SAME live store the guard verifies. */
function bootOpsServer(): OpsServer {
  const dir = mkdtempSync(join(tmpdir(), 'ops-accept-'));
  const rootTokens = createRootTokenStore({ path: join(dir, 'daemon-token') });
  const rootSecret = rootTokens.getOrCreateRoot();
  // Session store over a root GETTER sharing the SAME injected rootTokens (below)
  // — a captured string here would make the good-rotate case unfalsifiable.
  const sessionTokens = createSessionTokenStore({
    path: join(dir, 'revoked-devices.json'),
    rootToken: () => rootTokens.getOrCreateRoot(),
  });
  const prevQueue = process.env.AGENT_QUEUE_PATH;
  process.env.AGENT_QUEUE_PATH = mkdtempSync(
    join(tmpdir(), 'ops-accept-queue-'),
  );
  const handle = startWebServer({
    port: 0,
    // Clear the perimeter for the tunnel Host so case (CRITICAL-2) reaches
    // requireTrustedLocal. Loopback Hosts are always admitted regardless.
    allowedHosts: [TUNNEL_HOST],
    deviceRegistryPath: join(dir, 'devices.json'),
    sessionTokens,
    rootTokens, // SAME instance the session getter reads (deps.rootTokens)
    sessionTtlMs: 100_000,
  });
  return {
    port: handle.port,
    base: `http://127.0.0.1:${handle.port}`,
    localToken: handle.token,
    rootSecret,
    stop: async () => {
      await handle.pool.stop();
      handle.server.stop(true);
      handle.jobStore.close();
      if (prevQueue === undefined) delete process.env.AGENT_QUEUE_PATH;
      else process.env.AGENT_QUEUE_PATH = prevQueue;
    },
  };
}

// A LOOPBACK request (the physically-local browser) and a TUNNEL request (an
// allowlisted non-loopback Host that clears the perimeter but is NOT loopback).
const loopback = (srv: OpsServer, token: string) => ({
  authorization: `Bearer ${token}`,
  host: `127.0.0.1:${srv.port}`,
});
const tunnel = (token: string) => ({
  authorization: `Bearer ${token}`,
  host: TUNNEL_HOST,
});

/** Pair a device FROM the trusted-local browser; returns its minted id+token. */
async function pairDevice(
  srv: OpsServer,
  label: string,
): Promise<{ deviceId: string; token: string }> {
  const res = await fetch(`${srv.base}/api/devices`, {
    method: 'POST',
    headers: {
      ...loopback(srv, srv.localToken),
      'content-type': 'application/json',
    },
    body: JSON.stringify({ label }),
  });
  expect(res.status).toBe(202);
  return (await res.json()) as { deviceId: string; token: string };
}

async function listDeviceIds(
  srv: OpsServer,
  token: string = srv.localToken,
): Promise<string[]> {
  const res = await fetch(`${srv.base}/api/devices`, {
    headers: loopback(srv, token),
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { items: { deviceId: string }[] };
  return body.items.map((d) => d.deviceId);
}

const jobsStatus = (
  srv: OpsServer,
  token: string,
  host = loopback(srv, token),
) => fetch(`${srv.base}/api/jobs`, { headers: host }).then((r) => r.status);

// --- §7.1(1)+(6): IDOR + proto-pollution — the server always mints the id -----

test('§7.1(1,6) pair IGNORES a client deviceId/proto-pollution and mints a fresh UUID', async () => {
  const srv = bootOpsServer();
  try {
    // A hostile raw body: a client-chosen `deviceId:'local'` (IDOR) alongside
    // `__proto__`/`constructor` pollution keys. Built as a RAW string because a
    // `{ __proto__: ... }` object literal would set the prototype instead of
    // emitting a `"__proto__"` JSON key — we want the key ON the wire.
    const hostileBody =
      '{"label":"phone",' +
      '"deviceId":"local",' +
      '"__proto__":{"polluted":true},' +
      '"constructor":{"prototype":{"polluted":true}}}';
    const res = await fetch(`${srv.base}/api/devices`, {
      method: 'POST',
      headers: {
        ...loopback(srv, srv.localToken),
        'content-type': 'application/json',
      },
      body: hostileBody,
    });
    expect(res.status).toBe(202);
    const paired = (await res.json()) as { deviceId: string; token: string };

    // (1) IDOR: the injected 'local' id is NEVER honored — a fresh random UUID.
    expect(paired.deviceId).not.toBe('local');
    expect(paired.deviceId).toMatch(UUID_RE);
    // 'local' was never overwritten: the local token still authenticates.
    expect(await jobsStatus(srv, srv.localToken)).toBe(200);
    // The registry holds ONLY the server-minted id (never 'local', never a
    // client-chosen value).
    expect(await listDeviceIds(srv)).toEqual([paired.deviceId]);

    // (6) proto-pollution: nothing on Object.prototype was touched.
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect('polluted' in Object.prototype).toBe(false);
    expect({}.constructor).toBe(Object);

    // A second pair mints a DIFFERENT id — the client can never fix its identity.
    const second = await pairDevice(srv, 'tablet');
    expect(second.deviceId).not.toBe(paired.deviceId);
    expect(second.deviceId).toMatch(UUID_RE);
  } finally {
    await srv.stop();
  }
});

// --- §7.1(4): the pairing token is emitted ONCE and never leaks --------------

test('§7.1(4) the pairing token appears ONLY in the pair response — never in GET /api/devices or an error body', async () => {
  const srv = bootOpsServer();
  try {
    const { token } = await pairDevice(srv, 'phone');
    expect(token.length).toBeGreaterThan(10);

    // Never re-listed: the registry stores {deviceId,label,createdAt,exp} only.
    const listRes = await fetch(`${srv.base}/api/devices`, {
      headers: loopback(srv, srv.localToken),
    });
    expect(await listRes.text()).not.toContain(token);

    // Never echoed back on an error path either (a 400 bad-body pair).
    const errRes = await fetch(`${srv.base}/api/devices`, {
      method: 'POST',
      headers: {
        ...loopback(srv, srv.localToken),
        'content-type': 'application/json',
      },
      body: JSON.stringify({ label: '' }),
    });
    expect(errRes.status).toBe(400);
    expect(await errRes.text()).not.toContain(token);
  } finally {
    await srv.stop();
  }
});

// --- §7.1(2): trusted-local gate on ALL THREE mutations (non-'local' caller) --

test('§7.1(2) a paired REMOTE device (non-local principal) is 403 on pair/revoke/rotate with ZERO side effect', async () => {
  const srv = bootOpsServer();
  try {
    const victim = await pairDevice(srv, 'phone');
    // The remote device token authenticates for ordinary reads...
    expect(await jobsStatus(srv, victim.token)).toBe(200);

    // ...but its principal is a UUID, not 'local' — so all three privileged
    // writes are refused, even over a loopback Host.
    const remotePair = await fetch(`${srv.base}/api/devices`, {
      method: 'POST',
      headers: {
        ...loopback(srv, victim.token),
        'content-type': 'application/json',
      },
      body: JSON.stringify({ label: 'evil' }),
    });
    expect(remotePair.status).toBe(403);

    const remoteRevoke = await fetch(
      `${srv.base}/api/devices/${victim.deviceId}/revoke`,
      { method: 'POST', headers: loopback(srv, victim.token) },
    );
    expect(remoteRevoke.status).toBe(403);

    const remoteRotate = await fetch(`${srv.base}/api/security/rotate-root`, {
      method: 'POST',
      headers: {
        ...loopback(srv, victim.token),
        'content-type': 'application/json',
      },
      body: JSON.stringify({ rootSecret: srv.rootSecret }),
    });
    expect(remoteRotate.status).toBe(403); // rejected BEFORE the secret check

    // ZERO side effect: the victim is still registered, its token still
    // verifies, and the local token was never rotated out.
    expect(await listDeviceIds(srv)).toEqual([victim.deviceId]);
    expect(await jobsStatus(srv, victim.token)).toBe(200);
    expect(await jobsStatus(srv, srv.localToken)).toBe(200);
  } finally {
    await srv.stop();
  }
});

// --- §7.1(3) CRITICAL-2: the injected 'local' token replayed over a TUNNEL ----

test('§7.1(3) CRITICAL-2: a REMOTE tunnel client presenting the injected local token is 403 on pair/revoke/rotate', async () => {
  const srv = bootOpsServer();
  try {
    // Precondition: over LOOPBACK the same local token IS trusted-local (proves
    // the tunnel rejection below is the Host check, not a broken token).
    const okPair = await fetch(`${srv.base}/api/devices`, {
      method: 'POST',
      headers: {
        ...loopback(srv, srv.localToken),
        'content-type': 'application/json',
      },
      body: JSON.stringify({ label: 'phone' }),
    });
    expect(okPair.status).toBe(202);
    const victim = (await okPair.json()) as { deviceId: string };

    // The exact audit bypass: the SAME localToken, but arriving over the
    // allowlisted non-loopback Host. It clears the perimeter (allowlisted) and
    // the session guard (principal IS 'local'), yet requireTrustedLocal refuses
    // it because the Host is not loopback → 403 on every privileged write.
    const tunnelPair = await fetch(`${srv.base}/api/devices`, {
      method: 'POST',
      headers: {
        ...tunnel(srv.localToken),
        'content-type': 'application/json',
      },
      body: JSON.stringify({ label: 'evil-tunnel' }),
    });
    expect(tunnelPair.status).toBe(403);

    const tunnelRevoke = await fetch(
      `${srv.base}/api/devices/${victim.deviceId}/revoke`,
      { method: 'POST', headers: tunnel(srv.localToken) },
    );
    expect(tunnelRevoke.status).toBe(403);

    const tunnelRotate = await fetch(`${srv.base}/api/security/rotate-root`, {
      method: 'POST',
      headers: {
        ...tunnel(srv.localToken),
        'content-type': 'application/json',
      },
      body: JSON.stringify({ rootSecret: srv.rootSecret }),
    });
    expect(tunnelRotate.status).toBe(403); // rejected BEFORE the secret check

    // ZERO side effect: registry unchanged, local token still fully works. The
    // perimeter is closed from BOTH directions — the remote index never RECEIVES
    // the local token (see tests/server/loopback-index.test.ts, T20b), and even
    // a replayed one cannot mint/revoke/rotate here.
    expect(await listDeviceIds(srv)).toEqual([victim.deviceId]);
    expect(await jobsStatus(srv, srv.localToken)).toBe(200);
  } finally {
    await srv.stop();
  }
});

// --- §7.1(7): revoke completeness + 'local' self-revoke guard ----------------

test('§7.1(7) revoke removes the device from the list AND kills its token; self-revoking local is 400', async () => {
  const srv = bootOpsServer();
  try {
    const dev = await pairDevice(srv, 'phone');
    expect(await jobsStatus(srv, dev.token)).toBe(200); // verifies before revoke
    expect(await listDeviceIds(srv)).toEqual([dev.deviceId]);

    const revokeRes = await fetch(
      `${srv.base}/api/devices/${dev.deviceId}/revoke`,
      { method: 'POST', headers: loopback(srv, srv.localToken) },
    );
    expect(revokeRes.status).toBe(200);

    // Gone from the positive registry AND stops verifying (negative set).
    expect(await listDeviceIds(srv)).toEqual([]);
    expect(await jobsStatus(srv, dev.token)).toBe(401);

    // 'local' is sacrosanct: revoking it is a 400, and the local token survives.
    const selfRevoke = await fetch(`${srv.base}/api/devices/local/revoke`, {
      method: 'POST',
      headers: loopback(srv, srv.localToken),
    });
    expect(selfRevoke.status).toBe(400);
    expect(await jobsStatus(srv, srv.localToken)).toBe(200);
  } finally {
    await srv.stop();
  }
});

// --- §7.1(5): rotate self-survival + full invalidation + wrong-secret 401 ------

test('§7.1(5) rotate-root: wrong secret → 401 (untouched); right secret → 200, all OTHER tokens die, re-minted local survives', async () => {
  const srv = bootOpsServer();
  try {
    const a = await pairDevice(srv, 'phone');
    const b = await pairDevice(srv, 'tablet');
    expect(await jobsStatus(srv, a.token)).toBe(200);
    expect(await jobsStatus(srv, b.token)).toBe(200);

    // Wrong secret → 401, and nothing is invalidated or cleared.
    const badRotate = await fetch(`${srv.base}/api/security/rotate-root`, {
      method: 'POST',
      headers: {
        ...loopback(srv, srv.localToken),
        'content-type': 'application/json',
      },
      body: JSON.stringify({ rootSecret: 'WRONG' }),
    });
    expect(badRotate.status).toBe(401);
    expect(await jobsStatus(srv, a.token)).toBe(200);
    expect(await jobsStatus(srv, b.token)).toBe(200);
    expect(await jobsStatus(srv, srv.localToken)).toBe(200);
    expect((await listDeviceIds(srv)).sort()).toEqual(
      [a.deviceId, b.deviceId].sort(),
    );

    // Right secret → 200 with a re-minted local token.
    const goodRotate = await fetch(`${srv.base}/api/security/rotate-root`, {
      method: 'POST',
      headers: {
        ...loopback(srv, srv.localToken),
        'content-type': 'application/json',
      },
      body: JSON.stringify({ rootSecret: srv.rootSecret }),
    });
    expect(goodRotate.status).toBe(200);
    const { token: reMintedLocal } = (await goodRotate.json()) as {
      token: string;
    };

    // Full invalidation: EVERY other token (both devices + the pre-rotate local)
    // now 401s, and the registry is cleared.
    expect(await jobsStatus(srv, a.token)).toBe(401);
    expect(await jobsStatus(srv, b.token)).toBe(401);
    expect(await jobsStatus(srv, srv.localToken)).toBe(401);

    // Self-survival: the operator's re-minted local token authenticates against
    // the NEW root — the live end-to-end proof rotate is not a self-DoS.
    expect(await jobsStatus(srv, reMintedLocal)).toBe(200);
    // Registry cleared (listed via the re-minted local token, the only one that
    // still authenticates).
    expect(await listDeviceIds(srv, reMintedLocal)).toEqual([]);
  } finally {
    await srv.stop();
  }
});
