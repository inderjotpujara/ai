import { beforeEach, describe, expect, it } from 'vitest';
import { adoptPairingTokenFromHash, sessionToken } from './client.ts';

describe('pairing-token bootstrap', () => {
  beforeEach(() => localStorage.clear());

  it('adopts a #token= fragment into localStorage and strips it', () => {
    window.location.hash = '#token=abc.def.sig';
    adoptPairingTokenFromHash();
    expect(sessionToken()).toBe('abc.def.sig');
    expect(window.location.hash).toBe('');
  });

  it('falls back to window.__AGENT_TOKEN__ when no paired token is stored', () => {
    (window as unknown as { __AGENT_TOKEN__?: string }).__AGENT_TOKEN__ =
      'srv-token';
    expect(sessionToken()).toBe('srv-token');
  });
});
