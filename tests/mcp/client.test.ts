import { describe, expect, it } from 'bun:test';
import type { OAuthClientProvider } from '@ai-sdk/mcp';
import { buildHttpTransportConfig } from '../../src/mcp/client.ts';

/** Minimal OAuthClientProvider stub for contract tests — a mocked token
 *  source, never a live handshake (deferred; see docs/architecture.md §14). */
export function mockOAuthProvider(token: string): OAuthClientProvider {
  return {
    tokens: async () => ({ access_token: token, token_type: 'Bearer' }),
    saveTokens: () => {},
    redirectToAuthorization: () => {},
    saveCodeVerifier: () => {},
    codeVerifier: async () => 'verifier',
    get redirectUrl() {
      return 'https://localhost/callback';
    },
    get clientMetadata() {
      return { redirect_uris: ['https://localhost/callback'] };
    },
    clientInformation: async () => undefined,
  };
}

describe('buildHttpTransportConfig', () => {
  it('wires an authProvider into the transport config for OAuth entries', async () => {
    const provider = mockOAuthProvider('mock-access-token');
    const transport = buildHttpTransportConfig({
      type: 'http',
      url: 'https://example.test/mcp',
      authProvider: provider,
    });
    expect(transport.authProvider).toBe(provider);
    const tokens = await transport.authProvider?.tokens();
    expect(tokens?.access_token).toBe('mock-access-token');
  });

  it('leaves the static-key path unchanged: headers set, authProvider undefined', () => {
    const transport = buildHttpTransportConfig({
      type: 'http',
      url: 'https://example.test/mcp',
      headers: { Authorization: 'Bearer static-pat' },
    });
    expect(transport.headers).toEqual({ Authorization: 'Bearer static-pat' });
    expect(transport.authProvider).toBeUndefined();
  });
});
