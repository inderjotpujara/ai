/**
 * Real webhook secret store (Slice 25, Task 18, §7.1). Persists per-trigger HMAC
 * secrets to `~/.agent/trigger-secrets.json` at `0600`, keyed by a server-minted
 * `secretRef`. Replaces the fail-closed Task 16 stub (which resolved every ref
 * to `undefined`); the composition roots (daemon `buildRealDaemon` + standalone
 * `main.ts`) already call `createTriggerSecretStore`, so the real impl slots in.
 *
 * SECURITY (§7.1) — the whole point:
 *  - Secrets are generated SERVER-SIDE only (`crypto.randomBytes`), never
 *    client-supplied.
 *  - `mint()` generates a fresh ref + secret, persists, and returns BOTH exactly
 *    once (the create-response once-only display). Thereafter the file is the
 *    ONLY at-rest location of the raw secret.
 *  - `get(secretRef)` returns the raw secret for HMAC verification (Task 19) or
 *    `undefined`. Constant-time compare belongs to the Task 19 verifier — here
 *    we only hand back the raw material that supports it.
 *  - `remove(secretRef)` drops a secret on trigger delete.
 *  - The raw secret is NEVER logged, NEVER returned in a DTO, NEVER set as a
 *    span attribute. The store object exposes only `mint`/`get`/`remove` — no
 *    serialization surface a logger/DTO could pick the secret up from.
 *
 * Storage discipline mirrors `server/security/device-registry.ts` /
 * `root-token.ts` byte-for-byte: `~/.agent` dir `0700`, file `0600`, atomic
 * temp-write + rename, and fail-closed load — a present-but-corrupt file THROWS
 * rather than silently collapsing to an empty store (silently forgetting every
 * trigger's key is a fail-OPEN hazard).
 */

import { randomBytes } from 'node:crypto';
import {
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { TriggerSecretStore } from './engine.ts';

/** Default location: `~/.agent/trigger-secrets.json` (beside the root token and
 *  device registry, same `0600`/`0700` convention). */
export function defaultTriggerSecretsPath(): string {
  return join(homedir(), '.agent', 'trigger-secrets.json');
}

/** At-rest shape: `{ [secretRef]: hmacSecretHex }`. */
type SecretMap = Record<string, string>;

export function createTriggerSecretStore(config: {
  path?: string;
}): TriggerSecretStore {
  const path = config.path ?? defaultTriggerSecretsPath();
  let secrets: SecretMap = load(path);

  // Atomic write (byte-for-byte `device-registry.ts` persist): serialize to a
  // unique temp in the SAME dir minted 0600 up front, then rename over the
  // target (rename is atomic within a filesystem). A crash mid-write can never
  // leave a half-written secret file, and the secret is never briefly
  // world-readable.
  function persist(): void {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const tmp = `${path}.${randomBytes(6).toString('hex')}.tmp`;
    try {
      writeFileSync(tmp, JSON.stringify(secrets), { mode: 0o600 });
      renameSync(tmp, path);
    } catch (err) {
      try {
        unlinkSync(tmp);
      } catch {
        // best-effort cleanup; surface the original failure below
      }
      throw err;
    }
  }

  return {
    mint(): { secretRef: string; hmacSecret: string } {
      // Server-side generation only (§7.1): 256-bit secret + 72-bit ref, both
      // hex. Returned to the caller ONCE (create-response display); after this
      // the file is the sole place the raw secret lives.
      const secretRef = randomBytes(9).toString('hex');
      const hmacSecret = randomBytes(32).toString('hex');
      secrets = { ...secrets, [secretRef]: hmacSecret };
      persist();
      return { secretRef, hmacSecret };
    },
    get(secretRef: string): string | undefined {
      return secrets[secretRef];
    },
    remove(secretRef: string): void {
      if (!(secretRef in secrets)) return; // no-op if absent (no needless write)
      const next = { ...secrets };
      delete next[secretRef];
      secrets = next;
      persist();
    },
  };
}

/**
 * Load the secret map. An ABSENT file is a legitimate "no secrets yet" → `{}`.
 * A PRESENT-but-corrupt file (unparseable JSON, or not a JSON object) THROWS —
 * fail closed, matching `device-registry.ts` load: silently collapsing a
 * tampered/unreadable secret store to "no secrets" would drop every trigger's
 * verification key. Non-string values are dropped so a malformed row can never
 * masquerade as a secret.
 */
function load(path: string): SecretMap {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `Trigger secret store at ${path} exists but is not valid JSON — refusing ` +
        `to start with an unreadable secret store (fail closed): ${(err as Error).message}`,
    );
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(
      `Trigger secret store at ${path} exists but is not a JSON object — ` +
        `refusing to start with an unreadable secret store (fail closed).`,
    );
  }
  const out: SecretMap = {};
  for (const [ref, secret] of Object.entries(
    parsed as Record<string, unknown>,
  )) {
    if (typeof secret === 'string') out[ref] = secret;
  }
  return out;
}
