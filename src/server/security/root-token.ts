/**
 * Durable root-token store for the always-on local agent daemon (Slice 24
 * Increment 5).
 *
 * The root token is the daemon's disaster-if-leaked secret: it is the HMAC key
 * that every per-device session token (`session-token.ts`) is signed with, so
 * it NEVER leaves the host — a browser or remote client only ever holds a
 * derived session token, never this.
 *
 * Unlike the old per-process `mintSessionToken()` (which died on restart), this
 * root is minted ONCE and persisted to `~/.agent/daemon-token` at `0600`, so it
 * survives daemon restarts — a reconnecting device stays authorized without a
 * re-pair. `rotate()` is the break-glass control: it replaces the root, which
 * invalidates every outstanding session token at once (their sigs no longer
 * verify against the new key).
 *
 * Both writes are CRASH-ATOMIC (Slice 25b T19 review). A non-atomic
 * truncate-then-write could leave an EMPTY `daemon-token` after a crash; an
 * empty string used as the HMAC key makes every session-token signature
 * computable by anyone (HMAC with an empty key) — a fail-OPEN token-forgery
 * vector. We defend on both sides: writes are atomic (temp-file + rename/link,
 * mirroring `device-registry.ts`) so a crash can never leave a truncated root,
 * AND reads reject an empty/whitespace value as corrupt and self-heal by
 * re-minting — the store NEVER returns `''` as a key.
 */

import { randomBytes } from 'node:crypto';
import {
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/** Default root-token location: `~/.agent/daemon-token`. */
export function defaultRootTokenPath(): string {
  return join(homedir(), '.agent', 'daemon-token');
}

export type RootTokenStore = {
  getOrCreateRoot(): string;
  rotate(): string;
};

/** 256 bits of entropy, hex-encoded (64 chars) — matches `token.ts` sizing. */
function mint(): string {
  return randomBytes(32).toString('hex');
}

/** Cap the self-heal retry loop so a pathological race can never spin forever. */
const MAX_ESTABLISH_ATTEMPTS = 8;

export function createRootTokenStore(config: {
  path?: string;
}): RootTokenStore {
  const path = config.path ?? defaultRootTokenPath();

  // Parent dir is owner-only (0700), the token file owner-only read/write
  // (0600) — the same convention `daemon/pid.ts` uses for `~/.agent`. This
  // secret must never be group/world readable, and the temp files below are
  // minted 0600 up front so the secret is never briefly world-readable either.
  function ensureDir(): void {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  }

  function newTemp(): string {
    return `${path}.${randomBytes(6).toString('hex')}.tmp`;
  }

  // Read the root back, treating an empty/whitespace-only value (or a missing
  // file) as "no usable root". Returning `null` here is what stops the store
  // from ever handing an empty HMAC key to a caller.
  function readNonEmpty(): string | null {
    try {
      const t = readFileSync(path, 'utf8').trim();
      return t.length > 0 ? t : null;
    } catch {
      return null; // ENOENT / transient — treat as absent
    }
  }

  // Atomic, crash-safe OVERWRITE (rotate + self-heal): write the full token to a
  // unique temp in the SAME dir, then rename over the target. Rename is atomic
  // within a filesystem, so a crash mid-write leaves EITHER the old full root OR
  // the new full root — never a truncated/empty file. On failure the temp is
  // cleaned up so no `.tmp` is left behind.
  function atomicOverwrite(token: string): void {
    ensureDir();
    const tmp = newTemp();
    try {
      writeFileSync(tmp, token, { mode: 0o600 });
      renameSync(tmp, path);
    } catch (err) {
      try {
        unlinkSync(tmp);
      } catch {
        // best-effort cleanup; surface the original failure
      }
      throw err;
    }
  }

  // Atomic, EXCLUSIVE create (mint-once single-writer): write the full token to a
  // temp, then hard-LINK it onto the target. `link()` is atomic and fails with
  // EEXIST if the target already exists, so of two racing first-boot minters only
  // one wins; the loser sees EEXIST and re-reads the winner's token instead of
  // clobbering it. Crash-safe: the target only ever appears fully written (the
  // temp holds the complete token before the link). The temp is always removed.
  function exclusiveCreate(token: string): void {
    ensureDir();
    const tmp = newTemp();
    try {
      writeFileSync(tmp, token, { mode: 0o600 });
      linkSync(tmp, path); // EEXIST if another writer already created the root
    } finally {
      try {
        unlinkSync(tmp);
      } catch {
        // best-effort cleanup of the temp link
      }
    }
  }

  return {
    getOrCreateRoot(): string {
      // Mint-once with self-heal. An existing NON-EMPTY root is authoritative and
      // is never overwritten. An empty/whitespace root (e.g. left by a crash
      // inside a pre-atomic write — the fail-OPEN forgery vector) is treated as
      // corrupt: we clear it and re-mint atomically so the daemon heals itself.
      // The exclusive create + retry loop keeps concurrent healers convergent —
      // the loser of an EEXIST race re-reads the winner's token on the next pass.
      for (let attempt = 0; attempt < MAX_ESTABLISH_ATTEMPTS; attempt++) {
        const existing = readNonEmpty();
        if (existing) return existing;

        // No usable root: truly absent, or a corrupt empty remnant. Remove any
        // empty remnant first so the exclusive create below can claim the name.
        if (existsSync(path)) {
          try {
            unlinkSync(path);
          } catch {
            // raced with another healer — re-evaluate on the next iteration
          }
        }

        const token = mint();
        try {
          exclusiveCreate(token);
          return token;
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
            continue; // lost the race — next iteration re-reads the winner's root
          }
          throw err;
        }
      }
      throw new Error(
        'root-token: could not establish a non-empty root after retries',
      );
    },
    rotate(): string {
      const token = mint();
      atomicOverwrite(token); // crash-safe deliberate replace — never truncates
      return token;
    },
  };
}
