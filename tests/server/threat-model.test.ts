import { expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startWebServer } from '../../src/server/main.ts';

/**
 * §7.4 threat model, made executable (Slice 24 Increment 5, items 5/12/13).
 *
 * The layered perimeter, proven end-to-end through a real booted server:
 *   1. Host allowlist (DNS-rebinding defense) — enforcePerimeter, runs FIRST.
 *   2. Origin allowlist (CSRF / 0.0.0.0-day defense) — enforcePerimeter.
 *   3. Durable per-device session-token guard (the network is NOT the trust
 *      boundary) — runs only AFTER the perimeter passes.
 *
 * A Tailscale/Cloudflare tunnel makes the daemon reachable remotely; the tunnel
 * host is added to the Host allowlist (AGENT_WEB_ALLOWED_HOSTS) and the tunnel
 * origin to the Origin allowlist (AGENT_WEB_ORIGIN_ALLOWLIST). Reaching the
 * endpoint through the tunnel is necessary but NOT sufficient — the token guard
 * still gates every request.
 */

// A tunnel hostname (a Tailscale MagicDNS name) and its https origin. A tunnel
// commonly terminates TLS and forwards to the loopback port carrying the
// original (portless) Host header — hence the bare-host request below.
const TUNNEL_HOST = 'mac.tail-scale.ts.net';
const TUNNEL_ORIGIN = `https://${TUNNEL_HOST}`;

// Hermetic durable-auth paths so booting never reads/writes the real ~/.agent
// daemon token (mirrors auth-durable.test.ts / bind-address.test.ts).
function authPaths(): { rootTokenPath: string; sessionRevocationPath: string } {
  const dir = mkdtempSync(join(tmpdir(), 'threat-model-'));
  return {
    rootTokenPath: join(dir, 'daemon-token'),
    sessionRevocationPath: join(dir, 'revoked-devices.json'),
  };
}

/** Boot with the tunnel host + origin configured via env (proves the config
 *  seam end-to-end); `tunnel: false` = default-safe (no tunnel host allowed). */
function boot(opts: { tunnel: boolean }) {
  process.env.AGENT_WEB_ORIGIN_ALLOWLIST = TUNNEL_ORIGIN;
  if (opts.tunnel) {
    process.env.AGENT_WEB_ALLOWED_HOSTS = TUNNEL_HOST;
  } else {
    delete process.env.AGENT_WEB_ALLOWED_HOSTS;
  }
  return startWebServer({ port: 0, ...authPaths() });
}

async function teardown(h: {
  pool: { stop: () => Promise<void> };
  server: { stop: () => void };
  jobStore: { close: () => void };
}) {
  await h.pool.stop();
  h.server.stop();
  h.jobStore.close();
  delete process.env.AGENT_WEB_ORIGIN_ALLOWLIST;
  delete process.env.AGENT_WEB_ALLOWED_HOSTS;
}

// --- Layer 3: the network is NOT the trust boundary ----------------------

test('§7.4 valid tunnel host + valid session token → 200 (the legitimate remote user)', async () => {
  const h = boot({ tunnel: true });
  try {
    const res = await fetch(`http://127.0.0.1:${h.port}/api/jobs`, {
      headers: {
        host: TUNNEL_HOST,
        origin: TUNNEL_ORIGIN,
        authorization: `Bearer ${h.token}`,
      },
    });
    expect(res.status).toBe(200);
  } finally {
    await teardown(h);
  }
});

test('§7.4 valid tunnel host but NO token → 401 (passed the perimeter, failed the token guard)', async () => {
  const h = boot({ tunnel: true });
  try {
    const res = await fetch(`http://127.0.0.1:${h.port}/api/jobs`, {
      headers: { host: TUNNEL_HOST, origin: TUNNEL_ORIGIN },
    });
    expect(res.status).toBe(401); // network reachability alone is not enough
  } finally {
    await teardown(h);
  }
});

test('§7.4 valid tunnel host but an INVALID token → 401 (forged bearer, still not the trust boundary)', async () => {
  const h = boot({ tunnel: true });
  try {
    const res = await fetch(`http://127.0.0.1:${h.port}/api/jobs`, {
      headers: {
        host: TUNNEL_HOST,
        origin: TUNNEL_ORIGIN,
        authorization: 'Bearer not-a-real-signed-token',
      },
    });
    expect(res.status).toBe(401);
  } finally {
    await teardown(h);
  }
});

// --- Layer 1: Host allowlist (DNS-rebinding defense) ----------------------

test('§7.4 wrong Host (DNS-rebinding attacker) → 403 at the perimeter, BEFORE the token guard', async () => {
  const h = boot({ tunnel: true });
  try {
    // A VALID token is presented — proving the Host check fails CLOSED at the
    // perimeter before the token guard ever runs (403, not 401/200).
    const res = await fetch(`http://127.0.0.1:${h.port}/api/jobs`, {
      headers: {
        host: 'evil.attacker.example',
        origin: TUNNEL_ORIGIN,
        authorization: `Bearer ${h.token}`,
      },
    });
    expect(res.status).toBe(403);
  } finally {
    await teardown(h);
  }
});

// --- Layer 2: Origin allowlist (CSRF / 0.0.0.0-day defense) ---------------

test('§7.4 cross-origin Origin not in the allowlist → 403 at the perimeter', async () => {
  const h = boot({ tunnel: true });
  try {
    const res = await fetch(`http://127.0.0.1:${h.port}/api/jobs`, {
      headers: {
        host: TUNNEL_HOST,
        origin: 'https://evil.example',
        authorization: `Bearer ${h.token}`,
      },
    });
    expect(res.status).toBe(403);
  } finally {
    await teardown(h);
  }
});

// --- Default-safe: remote is explicit opt-in ------------------------------

test('§7.4 with NO tunnel configured, a non-localhost Host → 403 (default-safe, localhost-only)', async () => {
  const h = boot({ tunnel: false });
  try {
    // Even with a valid token, the tunnel host is not allowed when unconfigured.
    const res = await fetch(`http://127.0.0.1:${h.port}/api/jobs`, {
      headers: {
        host: TUNNEL_HOST,
        origin: TUNNEL_ORIGIN,
        authorization: `Bearer ${h.token}`,
      },
    });
    expect(res.status).toBe(403);
  } finally {
    await teardown(h);
  }
});

test('§7.4 no-regression: a loopback Host + valid token → 200 with no tunnel configured', async () => {
  const h = boot({ tunnel: false });
  try {
    const res = await fetch(`http://127.0.0.1:${h.port}/api/jobs`, {
      headers: {
        host: `127.0.0.1:${h.port}`,
        authorization: `Bearer ${h.token}`,
      },
    });
    expect(res.status).toBe(200);
  } finally {
    await teardown(h);
  }
});
