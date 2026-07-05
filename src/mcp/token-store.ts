import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export type StoredTokens = {
  access_token: string;
  token_type?: string;
  refresh_token?: string;
  expires_at?: number;
};

export type ClientRecord = { client_id: string; client_secret?: string };

/** Mirrors `@ai-sdk/mcp`'s `OAuthAuthorizationServerInformation` — the
 *  authorization-server identity discovered on the FIRST `auth()` call
 *  (DCR/redirect), which `auth()`'s code-exchange call requires back via the
 *  provider's `authorizationServerInformation()` or it throws "Stored OAuth
 *  authorization server metadata is required when exchanging an
 *  authorization code" (see oauth-provider.ts). New optional field — old
 *  stores without it still parse fine via `getServerAuth`'s `?? {}` fallback. */
export type AuthorizationServerInformation = {
  authorizationServerUrl: string;
  tokenEndpoint: string;
};

export type ServerAuthRecord = {
  tokens?: StoredTokens;
  codeVerifier?: string;
  client?: ClientRecord;
  authorizationServer?: AuthorizationServerInformation;
};

/** Default location: $XDG_CONFIG_HOME|~/.config + /ai/mcp-tokens.json.
 *  NOTE: this file holds real OAuth secrets in plaintext, protected only by
 *  0600 file permissions — encryption-at-rest is deliberately deferred to
 *  Slice 35. Do not weaken the permissions set in writeTokenStore(). */
export function tokenStorePath(): string {
  const configHome = process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
  return join(configHome, 'ai', 'mcp-tokens.json');
}

export function readTokenStore(
  path: string = tokenStorePath(),
): Record<string, ServerAuthRecord> {
  try {
    if (!existsSync(path)) return {};
    return JSON.parse(readFileSync(path, 'utf8')) as Record<
      string,
      ServerAuthRecord
    >;
  } catch {
    return {}; // corrupt store → re-auth, never crash
  }
}

/** Atomic write (temp + rename), mode 0600 on both temp and final file —
 *  this store holds real secrets so a world-readable window is unacceptable.
 *  The temp path is predictable (`${path}.tmp`), so a leftover from a prior
 *  crash could pre-exist with a wider mode (or be a symlink planted by
 *  another user) — `writeFileSync`'s `mode` option only applies on CREATE,
 *  not to an existing file. Remove any stale temp first, then re-assert 0600
 *  after writing, so the temp is 0600 before the rename regardless of what
 *  was there before. */
export function writeTokenStore(
  store: Record<string, ServerAuthRecord>,
  path: string = tokenStorePath(),
): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.tmp`;
  rmSync(tmp, { force: true });
  writeFileSync(tmp, JSON.stringify(store, null, 2), { mode: 0o600 });
  chmodSync(tmp, 0o600); // belt-and-suspenders: assert mode even if tmp pre-existed
  renameSync(tmp, path);
  chmodSync(path, 0o600); // belt-and-suspenders: rename should preserve mode, but verify
}

export function getServerAuth(
  server: string,
  path: string = tokenStorePath(),
): ServerAuthRecord {
  return readTokenStore(path)[server] ?? {};
}

/** Merges the record for `server` into the store and persists it. */
export function setServerAuth(
  server: string,
  rec: ServerAuthRecord,
  path: string = tokenStorePath(),
): void {
  const store = readTokenStore(path);
  store[server] = { ...store[server], ...rec };
  writeTokenStore(store, path);
}
