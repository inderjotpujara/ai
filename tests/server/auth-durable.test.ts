import { afterAll, beforeAll, expect, test } from 'bun:test';
import { Buffer } from 'node:buffer';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startWebServer } from '../../src/server/main.ts';
import { createRootTokenStore } from '../../src/server/security/root-token.ts';
import { createSessionTokenStore } from '../../src/server/security/session-token.ts';
import {
  createSessionGuard,
  MAX_BEARER_TOKEN_LEN,
} from '../../src/server/security/token.ts';
import { ATTR } from '../../src/telemetry/spans.ts';
import { registerTestProvider } from '../helpers/otel-test-provider.ts';

// Hermetic durable-auth paths — never touch the real ~/.agent daemon token.
const dir = mkdtempSync(join(tmpdir(), 'auth-durable-'));
const rootTokenPath = join(dir, 'daemon-token');
const sessionRevocationPath = join(dir, 'revoked-devices.json');

// The ROOT the server boots against (getOrCreateRoot mints + persists it once).
const rootToken = createRootTokenStore({
  path: rootTokenPath,
}).getOrCreateRoot();
// The SINGLE live session store — INJECTED into the server so the guard
// verifies against this exact instance (nit #2: an in-process revoke below
// takes effect immediately, no reload).
const sessions = createSessionTokenStore({
  path: sessionRevocationPath,
  rootToken,
});

let ctx: ReturnType<typeof registerTestProvider>;
let handle: ReturnType<typeof startWebServer>;
let base: string;

beforeAll(() => {
  ctx = registerTestProvider();
  handle = startWebServer({ port: 0, sessionTokens: sessions });
  base = `http://localhost:${handle.port}`;
});
afterAll(async () => {
  await handle.pool.stop();
  handle.server.stop(true);
  handle.jobStore.close();
});

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

test('a valid session-token bearer authenticates (200 on /api/jobs)', async () => {
  const token = sessions.mintSessionToken({
    deviceId: 'phone',
    ttlMs: 60_000,
  });
  const res = await fetch(`${base}/api/jobs`, { headers: auth(token) });
  expect(res.status).toBe(200);
});

test('the injected window.__AGENT_TOKEN__ is a SESSION token (deviceId "local"), NOT the root', async () => {
  const html = await (await fetch(`${base}/`)).text();
  // The daemon root must never reach the browser.
  expect(html).not.toContain(rootToken);
  const m = html.match(/window\.__AGENT_TOKEN__="([^"]+)"/);
  expect(m).not.toBeNull();
  const injected = m?.[1] as string;
  expect(injected).not.toBe(rootToken);
  // It verifies as a session token and decodes to the local browser device.
  const principal = sessions.verifySessionToken(injected);
  expect(principal?.deviceId).toBe('local');
  // The handle's returned token is that same injected session token.
  expect(handle.token).toBe(injected);
  // And it actually authenticates.
  const res = await fetch(`${base}/api/jobs`, { headers: auth(injected) });
  expect(res.status).toBe(200);
});

test('the ROOT token as a bearer is rejected (401) — the root is not a session token', async () => {
  const res = await fetch(`${base}/api/jobs`, { headers: auth(rootToken) });
  expect(res.status).toBe(401);
});

test('a bogus/forged bearer is rejected (401)', async () => {
  const forged = `${Buffer.from(JSON.stringify({ deviceId: 'x', exp: Date.now() + 60_000 })).toString('base64url')}.deadbeef`;
  expect(
    (await fetch(`${base}/api/jobs`, { headers: auth(forged) })).status,
  ).toBe(401);
  expect(
    (await fetch(`${base}/api/jobs`, { headers: auth('nonsense') })).status,
  ).toBe(401);
  expect((await fetch(`${base}/api/jobs`)).status).toBe(401);
});

test('an EXPIRED session token is rejected (401)', async () => {
  const expired = sessions.mintSessionToken({ deviceId: 'phone', ttlMs: -1 });
  const res = await fetch(`${base}/api/jobs`, { headers: auth(expired) });
  expect(res.status).toBe(401);
});

test('a REVOKED device token is rejected (401)', async () => {
  const token = sessions.mintSessionToken({
    deviceId: 'revoke-me',
    ttlMs: 60_000,
  });
  // Sanity: valid before revocation.
  expect(
    (await fetch(`${base}/api/jobs`, { headers: auth(token) })).status,
  ).toBe(200);
  sessions.revokeDevice('revoke-me');
  const res = await fetch(`${base}/api/jobs`, { headers: auth(token) });
  expect(res.status).toBe(401);
});

test('an over-long bearer is rejected by the guard BEFORE any decode/HMAC (cheap DoS guard, nit #5)', () => {
  // Tested at the guard directly: a multi-MB header never reaches the handler
  // (Bun caps request headers with its own 431), so the unit boundary is where
  // the length cap actually matters — and it is the path the beacon body-token
  // (verifyToken, no header limit) also relies on.
  const guard = createSessionGuard(sessions);
  const huge = 'a'.repeat(MAX_BEARER_TOKEN_LEN + 1);
  const req = new Request(`${base}/api/jobs`, {
    headers: { authorization: `Bearer ${huge}` },
  });
  expect(guard.verify(req)).toBe(false);
  expect(guard.verifyToken(huge)).toBe(false);
  // A token exactly at the cap is still length-eligible (rejected only because
  // it isn't a real signed token, not because of the length gate).
  expect(guard.verifyToken('a'.repeat(MAX_BEARER_TOKEN_LEN))).toBe(false);
});

test('the verified request span carries principal = the authenticating deviceId', async () => {
  const token = sessions.mintSessionToken({
    deviceId: 'traced-device',
    ttlMs: 60_000,
  });
  await fetch(`${base}/api/health`, { headers: auth(token) });
  const span = ctx.exporter
    .getFinishedSpans()
    .find(
      (s) =>
        s.name === 'server.request' &&
        s.attributes[ATTR.SERVER_PRINCIPAL] === 'traced-device',
    );
  expect(span).toBeDefined();
});

test('the served HTML and no request span ever contain the root token', async () => {
  const token = sessions.mintSessionToken({ deviceId: 'local', ttlMs: 60_000 });
  await fetch(`${base}/api/health`, { headers: auth(token) });
  const html = await (await fetch(`${base}/`)).text();
  expect(html).not.toContain(rootToken);
  for (const s of ctx.exporter.getFinishedSpans()) {
    for (const v of Object.values(s.attributes)) {
      expect(String(v)).not.toContain(rootToken);
    }
  }
});
