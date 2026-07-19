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
 */

import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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

export function createRootTokenStore(config: {
  path?: string;
}): RootTokenStore {
  const path = config.path ?? defaultRootTokenPath();

  // Parent dir is owner-only (0700), the token file owner-only read/write
  // (0600) — the same convention `daemon/pid.ts` uses for `~/.agent`. This
  // secret must never be group/world readable.
  function write(token: string): void {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(path, token, { mode: 0o600 });
  }

  return {
    getOrCreateRoot(): string {
      // Mint-once: an existing non-empty root is authoritative and is NEVER
      // overwritten, so concurrent/repeat calls (and restarts) all return the
      // same token. Only `rotate()` deliberately replaces it.
      if (existsSync(path)) {
        const t = readFileSync(path, 'utf8').trim();
        if (t.length > 0) return t;
      }
      const token = mint();
      write(token);
      return token;
    },
    rotate(): string {
      const token = mint();
      write(token);
      return token;
    },
  };
}
