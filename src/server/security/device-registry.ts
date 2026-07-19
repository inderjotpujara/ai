/**
 * Persisted POSITIVE device registry (Slice 25b, D4) — the first positive
 * device list beside the existing NEGATIVE `revoked-devices.json`
 * (`session-token.ts`). Records ONLY `{deviceId, label, createdAt, exp}` —
 * NEVER the minted token, which is transmitted exactly once in the pair
 * response (T17). `list()` prunes expired rows on read (and persists the prune)
 * so a lapsed device stops appearing. `0600` file / `0700` dir, atomic
 * temp+rename writes, matching the secure-file discipline of `session-token.ts`
 * and `root-token.ts`. Fail-closed on a corrupt file (a tampered/unreadable
 * registry must not silently un-list every device).
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

/** Default registry location: `~/.agent/devices.json` (sits beside the root
 *  token and revocation set, same `0600`/`0700` convention). */
export function defaultDeviceRegistryPath(): string {
  return join(homedir(), '.agent', 'devices.json');
}

export type DeviceRecord = {
  deviceId: string;
  label: string;
  createdAt: number;
  exp: number;
};

export type DeviceRegistry = {
  /** Live devices; prunes (and persists dropping) any with `exp <= now`. */
  list(now?: number): DeviceRecord[];
  /** Add a device, upserting on a duplicate `deviceId` (last write wins). */
  append(rec: DeviceRecord): void;
  /** Drop a single device by id (no-op if absent). */
  remove(deviceId: string): void;
  /** Drop every device (used by rotate-root, T19). */
  clear(): void;
};

export function createDeviceRegistry(config: {
  path?: string;
}): DeviceRegistry {
  const path = config.path ?? defaultDeviceRegistryPath();
  let devices: DeviceRecord[] = load(path);

  // Atomic write: serialize to a unique temp file in the SAME dir, then rename
  // over the target (rename is atomic within a filesystem), so a crash mid-write
  // can never leave a half-written / truncated registry. The temp file is minted
  // 0600 up front so the secret-adjacent data is never briefly world-readable.
  function persist(): void {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const tmp = `${path}.${randomBytes(6).toString('hex')}.tmp`;
    try {
      writeFileSync(tmp, JSON.stringify(devices), { mode: 0o600 });
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

  function list(now = Date.now()): DeviceRecord[] {
    const live = devices.filter((d) => d.exp > now);
    if (live.length !== devices.length) {
      devices = live; // prune persisted so a lapsed device stops showing
      persist();
    }
    return [...devices];
  }

  return {
    list,
    append(rec: DeviceRecord): void {
      devices = [...devices.filter((d) => d.deviceId !== rec.deviceId), rec];
      persist();
    },
    remove(deviceId: string): void {
      devices = devices.filter((d) => d.deviceId !== deviceId);
      persist();
    },
    clear(): void {
      devices = [];
      persist();
    },
  };
}

/**
 * Load the registry. An ABSENT file is a legitimate "nothing paired yet" →
 * `[]`. A PRESENT-but-corrupt file (unparseable JSON, or not a JSON array)
 * THROWS — fail closed: silently collapsing a tampered/unreadable positive
 * list to "no devices" would drop the audit trail and un-list every paired
 * device. Matches `loadRevoked` in `session-token.ts`.
 */
function load(path: string): DeviceRecord[] {
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
      `Device registry at ${path} exists but is not valid JSON — refusing to ` +
        `start with an unreadable device store (fail closed): ${(err as Error).message}`,
    );
  }
  if (!Array.isArray(parsed)) {
    throw new Error(
      `Device registry at ${path} exists but is not a JSON array — refusing ` +
        `to start with an unreadable device store (fail closed).`,
    );
  }
  return parsed.filter(
    (d): d is DeviceRecord =>
      typeof d === 'object' &&
      d !== null &&
      typeof (d as DeviceRecord).deviceId === 'string' &&
      typeof (d as DeviceRecord).label === 'string' &&
      typeof (d as DeviceRecord).createdAt === 'number' &&
      typeof (d as DeviceRecord).exp === 'number',
  );
}
