import { describe, expect, it, mock } from 'bun:test';
import type { OAuthClientProvider } from '@ai-sdk/mcp';
import { UnauthorizedError } from '@ai-sdk/mcp';
import {
  buildHttpTransportConfig,
  mountMcpServer,
} from '../../src/mcp/client.ts';
import type { LiveOAuthClientProvider } from '../../src/mcp/oauth-provider.ts';

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

/** Fake `LiveOAuthClientProvider` — adds `waitForRedirect` on top of the
 *  plain stub above so `mountMcpServer` recognizes it as able to complete an
 *  interactive handshake (see `hasWaitForRedirect` in src/mcp/client.ts). */
function mockLiveOAuthProvider(): LiveOAuthClientProvider {
  return {
    ...mockOAuthProvider('placeholder-token'),
    waitForRedirect: async () => ({ code: 'C', state: 'S' }),
  };
}

function fakeMcpClient(tools: Record<string, unknown>) {
  return {
    tools: async () => tools,
    close: async () => {},
  } as never;
}

describe('mountMcpServer — first-time OAuth handshake', () => {
  it('on UnauthorizedError, awaits the redirect, exchanges the code via auth(), and retries createClient once', async () => {
    const provider = mockLiveOAuthProvider();
    const waitForRedirectSpy = mock(provider.waitForRedirect);
    provider.waitForRedirect = waitForRedirectSpy;

    const retriedTools = { search: { description: 'x' } };
    let call = 0;
    const createClient = mock(async () => {
      call += 1;
      if (call === 1) throw new UnauthorizedError();
      return fakeMcpClient(retriedTools);
    });
    const authFn = mock(
      async (
        _provider: OAuthClientProvider,
        _opts: { authorizationCode?: string; callbackState?: string },
      ) => 'AUTHORIZED' as const,
    );

    const mounted = await mountMcpServer(
      {
        type: 'http',
        url: 'https://example.test/mcp',
        authProvider: provider,
      },
      { createClient, authFn },
    );

    expect(waitForRedirectSpy).toHaveBeenCalledTimes(1);
    expect(authFn).toHaveBeenCalledTimes(1);
    expect(authFn.mock.calls[0]?.[0]).toBe(provider);
    expect(authFn.mock.calls[0]?.[1]).toMatchObject({
      authorizationCode: 'C',
      callbackState: 'S',
    });
    expect(createClient).toHaveBeenCalledTimes(2);
    expect(mounted.tools.search).toBeDefined();
    await mounted.close();
  });

  it('rethrows if the retry after the handshake also fails', async () => {
    const provider = mockLiveOAuthProvider();
    const createClient = mock(async () => {
      throw new UnauthorizedError('still unauthorized');
    });
    const authFn = mock(async () => 'AUTHORIZED' as const);

    await expect(
      mountMcpServer(
        {
          type: 'http',
          url: 'https://example.test/mcp',
          authProvider: provider,
        },
        { createClient, authFn },
      ),
    ).rejects.toBeInstanceOf(UnauthorizedError);

    expect(createClient).toHaveBeenCalledTimes(2);
    expect(authFn).toHaveBeenCalledTimes(1);
  });

  it('leaves the non-OAuth path unchanged: no authFn call, single createClient attempt', async () => {
    const tools = { ping: { description: 'x' } };
    const createClient = mock(async () => fakeMcpClient(tools));
    const authFn = mock(async () => 'AUTHORIZED' as const);

    const mounted = await mountMcpServer(
      { type: 'http', url: 'https://example.test/mcp' },
      { createClient, authFn },
    );

    expect(createClient).toHaveBeenCalledTimes(1);
    expect(authFn).not.toHaveBeenCalled();
    expect(mounted.tools.ping).toBeDefined();
    await mounted.close();
  });

  it('an already-authorized OAuth spec (no 401) is unchanged: no handshake orchestration triggered', async () => {
    const provider = mockLiveOAuthProvider();
    const waitForRedirectSpy = mock(provider.waitForRedirect);
    provider.waitForRedirect = waitForRedirectSpy;
    const tools = { ping: { description: 'x' } };
    const createClient = mock(async () => fakeMcpClient(tools));
    const authFn = mock(async () => 'AUTHORIZED' as const);

    const mounted = await mountMcpServer(
      { type: 'http', url: 'https://example.test/mcp', authProvider: provider },
      { createClient, authFn },
    );

    expect(createClient).toHaveBeenCalledTimes(1);
    expect(waitForRedirectSpy).not.toHaveBeenCalled();
    expect(authFn).not.toHaveBeenCalled();
    expect(mounted.tools.ping).toBeDefined();
    await mounted.close();
  });
});
