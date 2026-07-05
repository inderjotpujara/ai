import { describe, expect, it } from 'bun:test';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  getServerAuth,
  readTokenStore,
  setServerAuth,
  tokenStorePath,
  writeTokenStore,
} from '../../src/mcp/token-store.ts';

describe('token-store', () => {
  it('round-trips tokens per server and writes 0600', () => {
    const path = join(tmpdir(), `mcp-tokens-${Date.now()}.json`);
    setServerAuth(
      'linear',
      { tokens: { access_token: 'abc', token_type: 'Bearer' } },
      path,
    );
    expect(getServerAuth('linear', path).tokens?.access_token).toBe('abc');
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it('missing file reads as empty, never throws', () => {
    expect(
      getServerAuth('nope', join(tmpdir(), `absent-${Date.now()}.json`)),
    ).toEqual({});
  });

  it('readTokenStore on a missing file returns {} without throwing', () => {
    expect(
      readTokenStore(join(tmpdir(), `absent-store-${Date.now()}.json`)),
    ).toEqual({});
  });

  it('readTokenStore on a corrupt file returns {} without throwing', () => {
    const path = join(tmpdir(), `corrupt-tokens-${Date.now()}.json`);
    writeFileSync(path, 'not json{{{');
    expect(readTokenStore(path)).toEqual({});
  });

  it('setServerAuth merges into existing store, preserving other servers', () => {
    const path = join(tmpdir(), `mcp-tokens-merge-${Date.now()}.json`);
    setServerAuth('a', { tokens: { access_token: 'a-token' } }, path);
    setServerAuth('b', { tokens: { access_token: 'b-token' } }, path);
    const store = readTokenStore(path);
    expect(store.a?.tokens?.access_token).toBe('a-token');
    expect(store.b?.tokens?.access_token).toBe('b-token');
  });

  it('setServerAuth field-merges into the existing record for the same server', () => {
    const path = join(tmpdir(), `mcp-tokens-merge-fields-${Date.now()}.json`);
    setServerAuth('a', { codeVerifier: 'v1' }, path);
    setServerAuth(
      'a',
      { tokens: { access_token: 'tok', token_type: 'Bearer' } },
      path,
    );
    const rec = getServerAuth('a', path);
    // The codeVerifier saved by the first call must survive the second call's
    // save of tokens — a whole-record replace would wipe it mid-handshake.
    expect(rec.codeVerifier).toBe('v1');
    expect(rec.tokens?.access_token).toBe('tok');
  });

  it('writeTokenStore creates the parent directory with mode 0700', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mcp-tokens-dir-'));
    const nested = join(dir, 'nested', 'ai');
    const path = join(nested, 'mcp-tokens.json');
    writeTokenStore({ x: { tokens: { access_token: 't' } } }, path);
    expect(existsSync(path)).toBe(true);
    expect(statSync(nested).mode & 0o777).toBe(0o700);
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it('a stale wider-mode temp file left from a prior crash does not leak — write() re-asserts 0600', () => {
    const path = join(tmpdir(), `mcp-tokens-stale-tmp-${Date.now()}.json`);
    const tmp = `${path}.tmp`;
    // Simulate a leftover temp from a crashed prior write: predictable name,
    // group/world-readable.
    writeFileSync(tmp, '{}', { mode: 0o644 });
    chmodSync(tmp, 0o644);
    setServerAuth(
      'linear',
      { tokens: { access_token: 'abc', token_type: 'Bearer' } },
      path,
    );
    expect(existsSync(tmp)).toBe(false); // renamed away
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(getServerAuth('linear', path).tokens?.access_token).toBe('abc');
  });

  it('tokenStorePath defaults under XDG_CONFIG_HOME or ~/.config', () => {
    const path = tokenStorePath();
    expect(path.endsWith(join('ai', 'mcp-tokens.json'))).toBe(true);
  });
});
