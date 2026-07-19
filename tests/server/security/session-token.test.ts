import { expect, test } from 'bun:test';
import { mkdtempSync, statSync } from 'node:fs';
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
