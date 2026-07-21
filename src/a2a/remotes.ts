/**
 * A2A CONSUME-side remote-agent store (Slice 31, Task 22) — persists remotes
 * added via the trusted-local Federation console. Each remote is discovered
 * and pinned (`createA2aClient().discover`) BEFORE it ever reaches `add`
 * (`server/a2a/remotes.ts`'s `handleRemoteAdd`), so nothing here re-validates
 * the card — this module is pure persistence.
 *
 * Mirrors `server/security/device-registry.ts` byte-for-byte: `0700` dir /
 * `0600` file, atomic temp+rename writes, fail-closed load (a present-but-
 * corrupt file THROWS rather than silently collapsing to "no remotes", which
 * would drop the record of a delegation target). Default path is
 * `AGENT_A2A_REMOTES_PATH` (`~/.config/ai/a2a-remotes.json`); the leading `~`
 * is expanded HERE, the single resolution site, mirroring the
 * `AGENT_TRIGGERS_WATCH_ROOT` convention (`triggers/confine.ts`).
 *
 * SECURITY: `token` (the remote's Bearer) is stored here — nowhere else — and
 * must NEVER be round-tripped into a DTO, span, or log. The one place that
 * strips it before a response leaves the process is `toRemoteDto`
 * (`server/a2a/remotes.ts`).
 */

import { randomBytes } from 'node:crypto';
import {
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';
import { loadConfig } from '../config/schema.ts';
import { expandHome } from '../triggers/confine.ts';
import type { RemoteAgent } from './client.ts';

export type RemoteStore = {
  list(): RemoteAgent[];
  get(name: string): RemoteAgent | undefined;
  /** Upsert on a duplicate `name` (last write wins — re-adding a remote with
   *  the same name re-pins it). */
  add(r: RemoteAgent): void;
  /** Drop a single remote by name (no-op if absent — idempotent). */
  remove(name: string): void;
};

export function createRemoteStore(config: { path?: string }): RemoteStore {
  const path = expandHome(
    config.path ?? String(loadConfig().values.AGENT_A2A_REMOTES_PATH),
  );
  let remotes: RemoteAgent[] = load(path);

  // Atomic write: serialize to a unique temp file in the SAME dir, then rename
  // over the target (rename is atomic within a filesystem), so a crash mid-write
  // can never leave a half-written / truncated store. The temp file is minted
  // 0600 up front so the token-bearing data is never briefly world-readable.
  function persist(): void {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const tmp = `${path}.${randomBytes(6).toString('hex')}.tmp`;
    try {
      writeFileSync(tmp, JSON.stringify(remotes), { mode: 0o600 });
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
    list(): RemoteAgent[] {
      return [...remotes];
    },
    get(name: string): RemoteAgent | undefined {
      return remotes.find((r) => r.name === name);
    },
    add(r: RemoteAgent): void {
      // Field-strip to exactly the five persisted fields (defense-in-depth):
      // the type forbids extras at compile time only — an `as any`/spread
      // caller could otherwise smuggle a stray property onto disk.
      const clean: RemoteAgent = {
        name: r.name,
        baseUrl: r.baseUrl,
        cardUrl: r.cardUrl,
        token: r.token,
        pinnedCardHash: r.pinnedCardHash,
      };
      remotes = [...remotes.filter((x) => x.name !== clean.name), clean];
      persist();
    },
    remove(name: string): void {
      remotes = remotes.filter((r) => r.name !== name);
      persist();
    },
  };
}

/**
 * Load the store. An ABSENT file is a legitimate "nothing added yet" → `[]`.
 * A PRESENT-but-corrupt file (unparseable JSON, or not a JSON array) THROWS —
 * fail closed: silently collapsing a tampered/unreadable store to "no
 * remotes" would drop the delegation record and mask tampering. Mirrors
 * `load` in `server/security/device-registry.ts`.
 */
function load(path: string): RemoteAgent[] {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `A2A remote store at ${path} exists but is not valid JSON — refusing ` +
        `to start with an unreadable remote store (fail closed): ${(err as Error).message}`,
    );
  }
  if (!Array.isArray(parsed)) {
    throw new Error(
      `A2A remote store at ${path} exists but is not a JSON array — refusing ` +
        `to start with an unreadable remote store (fail closed).`,
    );
  }
  return parsed
    .filter(
      (r): r is RemoteAgent =>
        typeof r === 'object' &&
        r !== null &&
        typeof (r as RemoteAgent).name === 'string' &&
        typeof (r as RemoteAgent).baseUrl === 'string' &&
        typeof (r as RemoteAgent).cardUrl === 'string' &&
        typeof (r as RemoteAgent).token === 'string' &&
        typeof (r as RemoteAgent).pinnedCardHash === 'string',
    )
    .map(
      (r): RemoteAgent => ({
        name: r.name,
        baseUrl: r.baseUrl,
        cardUrl: r.cardUrl,
        token: r.token,
        pinnedCardHash: r.pinnedCardHash,
      }),
    );
}
