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
import { createLogger } from '../log/logger.ts';
import { expandHome } from '../triggers/confine.ts';
import type { RemoteAgent } from './client.ts';

const log = createLogger('a2a.remotes');

/**
 * The remote-name charset — IDENTICAL to `A2aRemoteAddRequestSchema.name`
 * (`src/contracts/a2a.ts`). Enforced HERE, at the single persistence choke
 * point, because `name` becomes a LIVE `delegate_to_<name>` AI-SDK tool key AND
 * a line in `buildRoutingPrompt`'s catalog (Task 29b): a space/special char is
 * an invalid provider tool name (turn breakage) and a newline injects a
 * routing-prompt line. The HTTP schema guards the `/api/a2a/remotes` body, but
 * the CLI (`cli/a2a.ts`) derives `name` from the PEER-CONTROLLED `card.name` and
 * never touched that schema — so a hostile card name reached the live tool key
 * unchecked (capstone B6). Guarding `add` closes it for every caller. */
export const REMOTE_NAME_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;

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
      // §7.3 name-charset guard at the SINGLE choke point (capstone B6): reject
      // a non-conforming name before it is persisted / mounted as a live
      // `delegate_to_<name>` tool key + routing-prompt line. The CLI derives the
      // name from the peer-controlled `card.name`, which bypasses the HTTP
      // schema's identical guard — so enforce it here for every caller.
      if (!REMOTE_NAME_REGEX.test(r.name)) {
        throw new Error(
          `invalid remote name ${JSON.stringify(r.name)}: must match ` +
            `${REMOTE_NAME_REGEX.source} (letters, digits, '_' or '-', 1–64 chars)`,
        );
      }
      // Field-strip to exactly the six persisted fields (defense-in-depth):
      // the type forbids extras at compile time only — an `as any`/spread
      // caller could otherwise smuggle a stray property onto disk.
      const clean: RemoteAgent = {
        name: r.name,
        baseUrl: r.baseUrl,
        cardUrl: r.cardUrl,
        token: r.token,
        pinnedCardHash: r.pinnedCardHash,
        skillId: r.skillId,
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
  // Otherwise-well-formed except `skillId` — a pre-Task-30-FIX legacy record
  // (persisted before `skillId` existed on disk). Distinct from `isRemote`
  // below so a genuinely malformed entry (missing name/baseUrl/etc.) is
  // dropped silently as before, while a legacy skillId-less record is
  // dropped LOUDLY (it once named a real remote whose delegation target is
  // now unknown — fail closed, but tell the operator so it can be re-added).
  const isLegacyShape = (r: unknown): boolean =>
    typeof r === 'object' &&
    r !== null &&
    typeof (r as RemoteAgent).name === 'string' &&
    typeof (r as RemoteAgent).baseUrl === 'string' &&
    typeof (r as RemoteAgent).cardUrl === 'string' &&
    typeof (r as RemoteAgent).token === 'string' &&
    typeof (r as RemoteAgent).pinnedCardHash === 'string' &&
    typeof (r as RemoteAgent).skillId !== 'string';
  const isRemote = (r: unknown): r is RemoteAgent =>
    typeof r === 'object' &&
    r !== null &&
    typeof (r as RemoteAgent).name === 'string' &&
    typeof (r as RemoteAgent).baseUrl === 'string' &&
    typeof (r as RemoteAgent).cardUrl === 'string' &&
    typeof (r as RemoteAgent).token === 'string' &&
    typeof (r as RemoteAgent).pinnedCardHash === 'string' &&
    typeof (r as RemoteAgent).skillId === 'string';
  const droppedCount = parsed.filter(isLegacyShape).length;
  if (droppedCount > 0) {
    log.warn(
      `dropped ${droppedCount} legacy remote(s) lacking skillId — re-add them`,
      { path, count: droppedCount },
    );
  }
  return parsed.filter(isRemote).map(
    (r): RemoteAgent => ({
      name: r.name,
      baseUrl: r.baseUrl,
      cardUrl: r.cardUrl,
      token: r.token,
      pinnedCardHash: r.pinnedCardHash,
      skillId: r.skillId,
    }),
  );
}
