import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startWebServer } from '../../src/server/main.ts';
import { createRootTokenStore } from '../../src/server/security/root-token.ts';

/**
 * MANDATORY live proof (Fable T20 Critical) that the getter/same-instance
 * main.ts wiring makes rotate-root ACTUALLY invalidate. Boots a REAL standalone
 * `startWebServer` over temp dirs (no injected session store — the production
 * `else` branch, whose session store is built over a root GETTER that re-reads
 * the CURRENT root, and whose `deps.rootTokens` is that SAME hoisted rootStore),
 * then: pairs a device from loopback → the device token authenticates →
 * rotate-root with the correct root secret → the PAIRED device's token no longer
 * authenticates (401) AND the re-minted local token does (200). If the session
 * store had captured the root as a string (or used a different rootStore
 * instance than `deps.rootTokens`), the device token would STILL verify after
 * rotate and this test would fail — which is the whole point.
 */

const dir = mkdtempSync(join(tmpdir(), 'rotate-invalidation-'));
const rootTokenPath = join(dir, 'daemon-token');
const sessionRevocationPath = join(dir, 'revoked-devices.json');
const deviceRegistryPath = join(dir, 'devices.json');

// The root the server will boot against (getOrCreateRoot mints + persists it
// once; the server's own rootStore reads the same file → the same root).
const rootToken = createRootTokenStore({
  path: rootTokenPath,
}).getOrCreateRoot();

let prevQueue: string | undefined;
let handle: ReturnType<typeof startWebServer>;
let base: string;

beforeAll(() => {
  prevQueue = process.env.AGENT_QUEUE_PATH;
  process.env.AGENT_QUEUE_PATH = mkdtempSync(join(tmpdir(), 'rotate-queue-'));
  handle = startWebServer({
    port: 0,
    rootTokenPath,
    sessionRevocationPath,
    deviceRegistryPath,
  });
  base = `http://localhost:${handle.port}`;
});
afterAll(async () => {
  await handle.pool.stop();
  handle.server.stop(true);
  handle.jobStore.close();
  if (prevQueue === undefined) delete process.env.AGENT_QUEUE_PATH;
  else process.env.AGENT_QUEUE_PATH = prevQueue;
});

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

test('rotate-root live-invalidates a paired device token while re-minting the local one', async () => {
  // 1. Pair a device FROM the loopback local browser (handle.token is the
  //    'local' session token; Host localhost:port is loopback → trusted-local).
  const pairRes = await fetch(`${base}/api/devices`, {
    method: 'POST',
    headers: { ...auth(handle.token), 'content-type': 'application/json' },
    body: JSON.stringify({ label: 'phone' }),
  });
  expect(pairRes.status).toBe(202);
  const { token: deviceToken } = (await pairRes.json()) as { token: string };

  // 2. The paired device token authenticates against the live guard.
  expect(
    (await fetch(`${base}/api/jobs`, { headers: auth(deviceToken) })).status,
  ).toBe(200);

  // 3. Break-glass rotate-root with the correct current root secret.
  const rotateRes = await fetch(`${base}/api/security/rotate-root`, {
    method: 'POST',
    headers: { ...auth(handle.token), 'content-type': 'application/json' },
    body: JSON.stringify({ rootSecret: rootToken }),
  });
  expect(rotateRes.status).toBe(200);
  const { token: reMintedLocal } = (await rotateRes.json()) as {
    token: string;
  };

  // 4. The PAIRED device token is now dead — the getter re-read the rotated
  //    root, so its HMAC sig no longer verifies (this is the no-op-if-wired-
  //    wrong assertion).
  expect(
    (await fetch(`${base}/api/jobs`, { headers: auth(deviceToken) })).status,
  ).toBe(401);

  // 5. The operator's own tab survives: the re-minted local token authenticates.
  expect(
    (await fetch(`${base}/api/jobs`, { headers: auth(reMintedLocal) })).status,
  ).toBe(200);

  // 6. And the OLD local token (signed with the pre-rotate root) is dead too.
  expect(
    (await fetch(`${base}/api/jobs`, { headers: auth(handle.token) })).status,
  ).toBe(401);
});
