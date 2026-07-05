import { createHash, randomUUID } from 'node:crypto';

/** Minimal, spec-shaped OAuth 2.1 authorization server for deterministic
 *  local tests: authorization-server metadata discovery, Dynamic Client
 *  Registration, an `/authorize` that redirects with NO human step (unlike a
 *  real AS, which would show a consent screen), and a PKCE (S256)-checked
 *  `/token`. It intentionally does NOT implement protected-resource metadata
 *  (`/.well-known/oauth-protected-resource`) — the SDK's discovery call for
 *  that is wrapped in a try/catch that silently falls back to treating the
 *  resource URL itself as the authorization-server URL (see
 *  `authInternal`/`discoverOAuthProtectedResourceMetadata` in
 *  `@ai-sdk/mcp`'s `dist/index.js`), so a bare 404 here is spec-compliant
 *  behavior the SDK already tolerates. */

type PendingAuthorization = {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  state: string;
};

function base64url(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export type MockOAuthAs = {
  /** Root origin — pass this as both the MCP `serverUrl` and the
   *  authorization-server URL: with no path component, `@ai-sdk/mcp`'s
   *  discovery hits `/.well-known/oauth-authorization-server` at this exact
   *  origin and expects `issuer` to equal it. */
  url: string;
  registeredClientIds: string[];
  issuedTokens: { access_token: string; refresh_token: string }[];
  stop(): void;
};

/** Starts the mock AS on an ephemeral loopback port. */
export function startMockOAuthAs(): MockOAuthAs {
  const codesByCode = new Map<string, PendingAuthorization>();
  const registeredClientIds: string[] = [];
  const issuedTokens: { access_token: string; refresh_token: string }[] = [];

  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      const origin = `${url.protocol}//${url.host}`;

      if (
        req.method === 'GET' &&
        url.pathname === '/.well-known/oauth-authorization-server'
      ) {
        return Response.json({
          issuer: origin,
          authorization_endpoint: `${origin}/authorize`,
          token_endpoint: `${origin}/token`,
          registration_endpoint: `${origin}/register`,
          response_types_supported: ['code'],
          grant_types_supported: ['authorization_code', 'refresh_token'],
          code_challenge_methods_supported: ['S256'],
          token_endpoint_auth_methods_supported: ['none'],
        });
      }

      if (req.method === 'POST' && url.pathname === '/register') {
        const body = (await req.json()) as { redirect_uris?: string[] };
        const clientId = `mock-client-${randomUUID()}`;
        registeredClientIds.push(clientId);
        return Response.json({ ...body, client_id: clientId });
      }

      if (req.method === 'GET' && url.pathname === '/authorize') {
        const clientId = url.searchParams.get('client_id') ?? '';
        const redirectUri = url.searchParams.get('redirect_uri') ?? '';
        const codeChallenge = url.searchParams.get('code_challenge') ?? '';
        const state = url.searchParams.get('state') ?? '';
        if (!clientId || !redirectUri || !codeChallenge) {
          return new Response('Bad request', { status: 400 });
        }
        const code = `mock-code-${randomUUID()}`;
        codesByCode.set(code, { clientId, redirectUri, codeChallenge, state });
        const redirect = new URL(redirectUri);
        redirect.searchParams.set('code', code);
        redirect.searchParams.set('state', state);
        // Immediate 302 — no consent screen, no human step.
        return Response.redirect(redirect.toString(), 302);
      }

      if (req.method === 'POST' && url.pathname === '/token') {
        const text = await req.text();
        const params = new URLSearchParams(text);
        const grantType = params.get('grant_type');

        if (grantType === 'authorization_code') {
          const code = params.get('code') ?? '';
          const verifier = params.get('code_verifier') ?? '';
          const pending = codesByCode.get(code);
          if (!pending) {
            return Response.json(
              { error: 'invalid_grant', error_description: 'unknown code' },
              { status: 400 },
            );
          }
          const expectedChallenge = base64url(
            createHash('sha256').update(verifier).digest(),
          );
          if (expectedChallenge !== pending.codeChallenge) {
            return Response.json(
              {
                error: 'invalid_grant',
                error_description: 'PKCE verification failed',
              },
              { status: 400 },
            );
          }
          codesByCode.delete(code); // authorization codes are single-use
          const tokens = {
            access_token: `mock-access-${randomUUID()}`,
            refresh_token: `mock-refresh-${randomUUID()}`,
          };
          issuedTokens.push(tokens);
          return Response.json({
            access_token: tokens.access_token,
            token_type: 'Bearer',
            expires_in: 3600,
            refresh_token: tokens.refresh_token,
          });
        }

        if (grantType === 'refresh_token') {
          const tokens = {
            access_token: `mock-access-${randomUUID()}`,
            refresh_token: params.get('refresh_token') ?? '',
          };
          issuedTokens.push(tokens);
          return Response.json({
            access_token: tokens.access_token,
            token_type: 'Bearer',
            expires_in: 3600,
          });
        }

        return Response.json(
          { error: 'unsupported_grant_type' },
          { status: 400 },
        );
      }

      return new Response('Not found', { status: 404 });
    },
  });

  if (server.port === undefined) {
    throw new Error('mock OAuth AS has no bound port');
  }

  return {
    url: `http://127.0.0.1:${server.port}/`,
    registeredClientIds,
    issuedTokens,
    stop: () => server.stop(true),
  };
}
