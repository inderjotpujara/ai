import { expect, test } from 'bun:test';
import { createHmac } from 'node:crypto';
import { mkdtempSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRootTokenStore } from '../../../src/server/security/root-token.ts';
import { createSessionTokenStore } from '../../../src/server/security/session-token.ts';

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'tok-'));
}

function stores(dir = tempDir()) {
  const rootStore = createRootTokenStore({ path: join(dir, 'daemon-token') });
  const rootToken = rootStore.getOrCreateRoot();
  const store = createSessionTokenStore({
    path: join(dir, 'sessions'),
    rootToken,
  });
  return { dir, rootStore, rootToken, store };
}

// Property 1: a valid, unexpired token for a non-revoked device verifies and
// returns the right deviceId.
test('mint + verify round-trips a device id within TTL', () => {
  const { store } = stores();
  const tok = store.mintSessionToken({ deviceId: 'mac-2', ttlMs: 60_000 });
  expect(store.verifySessionToken(tok)?.deviceId).toBe('mac-2');
});

// Property 2: an EXPIRED token fails.
test('an expired token verifies null', () => {
  const { store } = stores();
  expect(
    store.verifySessionToken(
      store.mintSessionToken({ deviceId: 'd', ttlMs: -1 }),
    ),
  ).toBeNull();
});

// Property 4: a tampered / forged token fails.
test('a tampered token verifies null', () => {
  const { store } = stores();
  const tok = store.mintSessionToken({ deviceId: 'd', ttlMs: 60_000 });
  expect(store.verifySessionToken(`${tok}x`)).toBeNull();
});

test('a forged signature over a different root verifies null', () => {
  const { store } = stores();
  // A token minted by an UNRELATED root must not verify against this store.
  const other = createSessionTokenStore({
    path: join(tempDir(), 'sessions'),
    rootToken: 'deadbeef'.repeat(8),
  });
  const forged = other.mintSessionToken({ deviceId: 'd', ttlMs: 60_000 });
  expect(store.verifySessionToken(forged)).toBeNull();
});

test('a structurally malformed token verifies null (no split part)', () => {
  const { store } = stores();
  expect(store.verifySessionToken('not-a-token')).toBeNull();
  expect(store.verifySessionToken('')).toBeNull();
});

// Property 3: a REVOKED device's token fails while OTHER devices still verify.
test('revokeDevice invalidates without rotating root', () => {
  const { store } = stores();
  const tok = store.mintSessionToken({ deviceId: 'd', ttlMs: 60_000 });
  store.revokeDevice('d');
  expect(store.verifySessionToken(tok)).toBeNull();
});

test('revoking one device leaves other devices verifiable (no root rotation)', () => {
  const { store } = stores();
  const revoked = store.mintSessionToken({ deviceId: 'mac-1', ttlMs: 60_000 });
  const kept = store.mintSessionToken({ deviceId: 'mac-2', ttlMs: 60_000 });
  store.revokeDevice('mac-1');
  expect(store.verifySessionToken(revoked)).toBeNull();
  expect(store.verifySessionToken(kept)?.deviceId).toBe('mac-2');
});

test('revocation survives a restart (persisted 0600 set)', () => {
  const { dir, store, rootToken } = stores();
  const tok = store.mintSessionToken({ deviceId: 'mac-1', ttlMs: 60_000 });
  store.revokeDevice('mac-1');
  // Fresh store over the same files = "restart".
  const reopened = createSessionTokenStore({
    path: join(dir, 'sessions'),
    rootToken,
  });
  expect(reopened.verifySessionToken(tok)).toBeNull();
  expect(statSync(join(dir, 'sessions')).mode & 0o777).toBe(0o600);
});

// Property 6: rotating the root invalidates ALL existing session tokens.
test('rotating the root invalidates every session minted under the old root', () => {
  const { dir, rootStore, store } = stores();
  const tok = store.mintSessionToken({ deviceId: 'mac-2', ttlMs: 60_000 });
  expect(store.verifySessionToken(tok)?.deviceId).toBe('mac-2');
  const rotated = rootStore.rotate();
  const after = createSessionTokenStore({
    path: join(dir, 'sessions'),
    rootToken: rotated,
  });
  expect(after.verifySessionToken(tok)).toBeNull();
});

// AUDIT CRITICAL-1 — the root getter. When the store is built with a GETTER
// (not a captured string), a rotate() of the underlying root takes effect on
// the SAME live store: a token minted AFTER the rotate verifies against the new
// root, and one minted BEFORE it no longer does. A captured-string store would
// keep signing/verifying with the stale root, making rotate-root a no-op — this
// is exactly the seam T19's rotate-root route depends on.
test('a store built with a root GETTER honours rotate() per-call (pre-rotate token dies, post-rotate token lives)', () => {
  const dir = tempDir();
  const rootStore = createRootTokenStore({ path: join(dir, 'daemon-token') });
  rootStore.getOrCreateRoot();
  // Build the store over a GETTER that re-reads the live root every call.
  const store = createSessionTokenStore({
    path: join(dir, 'sessions'),
    rootToken: () => rootStore.getOrCreateRoot(),
  });

  const before = store.mintSessionToken({ deviceId: 'mac-2', ttlMs: 60_000 });
  expect(store.verifySessionToken(before)?.deviceId).toBe('mac-2');

  // Break-glass: rotate the underlying root (overwrites the file).
  rootStore.rotate();

  // The pre-rotate token no longer verifies — its sig was over the OLD root,
  // and the getter now resolves the NEW one on every verify call.
  expect(store.verifySessionToken(before)).toBeNull();
  // A token minted AFTER the rotate is signed with the new root and verifies —
  // proving mint + verify both resolve the root per-call, not once at build.
  const after = store.mintSessionToken({ deviceId: 'mac-3', ttlMs: 60_000 });
  expect(store.verifySessionToken(after)?.deviceId).toBe('mac-3');
});

// Property 5: verify is constant-time by construction — a length-mismatched
// candidate signature returns null (via the timingSafeEqual length guard),
// it never throws (which is what an unguarded timingSafeEqual would do).
test('a length-mismatched signature returns null, never throws', () => {
  const { store } = stores();
  const tok = store.mintSessionToken({ deviceId: 'd', ttlMs: 60_000 });
  const payload = tok.split('.')[0];
  // Replace the signature with a too-short one — timingSafeEqual would THROW
  // on unequal buffer lengths; the guard must catch that and return null.
  const shortSig = `${payload}.aa`;
  expect(() => store.verifySessionToken(shortSig)).not.toThrow();
  expect(store.verifySessionToken(shortSig)).toBeNull();
});

// Fix 1 — finite-exp guard: a non-finite `exp` must be rejected exactly like a
// missing/wrong-type `exp`, not merely "any number" as the old guard allowed.
// NaN/Infinity can't survive JSON.stringify (they coerce to `null`), so we
// can't get one out of `mintSessionToken`. Instead we hand-build the wire
// payload and sign it with the SAME HMAC helper the store documents in its
// header comment (`HMAC-SHA256(rootToken, payload)`, hex-encoded) — a valid
// signature over a malicious payload, exactly what a store-internal bug or a
// future JSON-quirk could produce. `1e400` is valid JSON number syntax, but
// overflows a double to `Infinity` once parsed — the reachable case the guard
// exists for.
test('a validly-signed payload with a non-finite exp verifies null (finite-exp guard)', () => {
  const { store, rootToken } = stores();
  const payloadJson = '{"deviceId":"d","exp":1e400}';
  // Sanity: confirm this really does parse to a non-finite exp.
  expect(Number.isFinite(JSON.parse(payloadJson).exp)).toBe(false);

  const payload = Buffer.from(payloadJson).toString('base64url');
  const sig = createHmac('sha256', rootToken).update(payload).digest('hex');
  expect(store.verifySessionToken(`${payload}.${sig}`)).toBeNull();
});

// Fix 2 — fail-closed revocation store: an ABSENT file is a legitimate "no
// revocations yet" (verifies still succeed); a PRESENT-but-corrupt file must
// fail CLOSED at construction rather than silently collapsing to "nothing
// revoked" (which would un-revoke every device).
test('an absent revocation file yields an empty revoked set — verifies still succeed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tok-'));
  const rootStore = createRootTokenStore({ path: join(dir, 'daemon-token') });
  const rootToken = rootStore.getOrCreateRoot();
  // Note: `join(dir, 'sessions')` is never created before construction.
  const store = createSessionTokenStore({
    path: join(dir, 'sessions'),
    rootToken,
  });
  const tok = store.mintSessionToken({ deviceId: 'd', ttlMs: 60_000 });
  expect(store.verifySessionToken(tok)?.deviceId).toBe('d');
});

test('a present-but-corrupt revocation file fails closed at construction (throws, never silently un-revokes)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tok-'));
  const path = join(dir, 'sessions');
  writeFileSync(path, 'not-json{{{', { mode: 0o600 });
  expect(() =>
    createSessionTokenStore({ path, rootToken: 'a'.repeat(64) }),
  ).toThrow();
});

test('a present-but-non-array-JSON revocation file also fails closed at construction', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tok-'));
  const path = join(dir, 'sessions');
  writeFileSync(path, JSON.stringify({ not: 'an array' }), { mode: 0o600 });
  expect(() =>
    createSessionTokenStore({ path, rootToken: 'a'.repeat(64) }),
  ).toThrow();
});
