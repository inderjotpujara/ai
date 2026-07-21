import { expect, test } from 'bun:test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createA2aEnrollment } from '../../src/a2a/enroll.ts';
import type { RootTokenStore } from '../../src/server/security/root-token.ts';
import { createRootTokenStore } from '../../src/server/security/root-token.ts';
import { createSessionTokenStore } from '../../src/server/security/session-token.ts';

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'a2a-enroll-'));
}

/** A real root store over a temp file — the daemon's actual root primitive. */
function realRoot(dir = tempDir()): { dir: string; root: RootTokenStore } {
  return {
    dir,
    root: createRootTokenStore({ path: join(dir, 'daemon-token') }),
  };
}

/** A fake root store whose root can be swapped at will (rotate simulation). */
function mutableRoot(initial: string): {
  store: RootTokenStore;
  set: (v: string) => void;
} {
  let current = initial;
  return {
    store: {
      getOrCreateRoot: () => current,
      rotate: () => {
        current = `${current}-rotated`;
        return current;
      },
    },
    set: (v) => {
      current = v;
    },
  };
}

function enrollment(dir = tempDir()) {
  const { root } = realRoot(dir);
  const registryPath = join(dir, 'a2a-tokens.json');
  return {
    dir,
    root,
    registryPath,
    enroll: createA2aEnrollment({ rootTokens: root, registryPath }),
  };
}

// Property 1: an issued A2A Bearer verifies true; a truncated/garbage token
// verifies false and NEVER throws (the timingSafeEqual length guard).
test('issue → verify round-trip; verify is constant-time (length-guarded)', () => {
  const { enroll } = enrollment();
  const { token } = enroll.issue('laptop');
  expect(enroll.verify(token)).toBe(true);

  // Truncated signature would make timingSafeEqual THROW without a length
  // guard — must return false instead.
  const payload = token.split('.')[0];
  expect(() => enroll.verify(`${payload}.aa`)).not.toThrow();
  expect(enroll.verify(`${payload}.aa`)).toBe(false);
  expect(enroll.verify('not-a-token')).toBe(false);
  expect(enroll.verify('')).toBe(false);
  expect(enroll.verify(`${token}x`)).toBe(false); // tampered sig
});

// Property 2: revoke removes the tokenId from the registry so it stops
// verifying, while another issued token keeps working.
test('revoke invalidates a previously-valid token', () => {
  const { enroll } = enrollment();
  const a = enroll.issue('a');
  const b = enroll.issue('b');
  expect(enroll.verify(a.token)).toBe(true);
  expect(enroll.verify(b.token)).toBe(true);
  enroll.revoke(a.id);
  expect(enroll.verify(a.token)).toBe(false);
  expect(enroll.verify(b.token)).toBe(true); // sibling unaffected
});

// Property 3: because the sig is keyed by the CURRENT root (resolved per call),
// rotating the root invalidates every outstanding A2A Bearer at once.
test('rotating the root invalidates every A2A Bearer at once', () => {
  const dir = tempDir();
  const { store, set } = mutableRoot('a'.repeat(64));
  const enroll = createA2aEnrollment({
    rootTokens: store,
    registryPath: join(dir, 'a2a-tokens.json'),
  });
  const before = enroll.issue('one');
  expect(enroll.verify(before.token)).toBe(true);

  // Break-glass: the underlying root changes.
  set('b'.repeat(64));

  // The pre-rotate token no longer verifies — its sig was over the OLD root and
  // verify recomputes with the NEW one on every call.
  expect(enroll.verify(before.token)).toBe(false);
  // A token minted AFTER the rotate is signed with the new root and verifies —
  // proving both issue and verify resolve the root per-call, not at construction.
  const after = enroll.issue('two');
  expect(enroll.verify(after.token)).toBe(true);
});

// Property 4 (D5): the A2A Bearer and device session-token domains are
// provably disjoint even when signed by the SAME root — an A2A token must not
// verify as a session token, and a session token must not verify as an A2A
// Bearer. Guaranteed by the `kind:'a2a'` discriminator + the separate stores.
test('a device session token is NOT accepted by A2A verify, and vice-versa (D5 separation)', () => {
  const dir = tempDir();
  const { root } = realRoot(dir);
  const registryPath = join(dir, 'a2a-tokens.json');
  const enroll = createA2aEnrollment({ rootTokens: root, registryPath });
  // The session store shares the SAME root — disjointness must NOT depend on a
  // different key, only on the payload discriminator + separate registry.
  const session = createSessionTokenStore({
    path: join(dir, 'sessions'),
    rootToken: () => root.getOrCreateRoot(),
  });

  const a2a = enroll.issue('remote');
  const sess = session.mintSessionToken({ deviceId: 'mac-2', ttlMs: 60_000 });

  // Sanity: each verifies in its OWN domain.
  expect(enroll.verify(a2a.token)).toBe(true);
  expect(session.verifySessionToken(sess)?.deviceId).toBe('mac-2');

  // Cross-domain: neither is accepted by the other.
  expect(session.verifySessionToken(a2a.token)).toBeNull();
  expect(enroll.verify(sess)).toBe(false);
});

// Property 5: the registry stores ONLY metadata + a non-reversible fingerprint,
// never the raw secret. list() rows have no `token` field, and the on-disk file
// contains neither the raw token nor its signature.
test('the registry never stores or returns the raw secret', () => {
  const { enroll, registryPath } = enrollment();
  const { id, token } = enroll.issue('printed-once');
  const sig = token.split('.')[1];

  const rows = enroll.list();
  expect(rows).toHaveLength(1);
  expect(rows[0]).toEqual({
    id,
    label: 'printed-once',
    createdAt: expect.any(Number),
  });
  // No secret-bearing fields leak through the DTO.
  expect(rows[0]).not.toHaveProperty('token');
  expect(rows[0]).not.toHaveProperty('sig');
  expect(rows[0]).not.toHaveProperty('hash');

  // On disk: the raw token and its signature never appear.
  const onDisk = readFileSync(registryPath, 'utf8');
  expect(onDisk).not.toContain(token);
  expect(onDisk).not.toContain(sig);
});
