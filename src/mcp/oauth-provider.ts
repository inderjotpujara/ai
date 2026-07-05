import type {
  OAuthClientInformation,
  OAuthClientMetadata,
  OAuthClientProvider,
  OAuthTokens,
} from '@ai-sdk/mcp';
import { withWallClock } from '../reliability/timeout.ts';
import { loopbackRedirectUri } from './loopback.ts';
import { getServerAuth, setServerAuth, tokenStorePath } from './token-store.ts';

const CLIENT_NAME = 'ai-local-agent';
/** Matches the loopback's own no-show guard (src/mcp/loopback.ts) so a
 *  hung browser flow fails the same way either caller uses. */
const REDIRECT_WAIT_TIMEOUT_MS = 180_000;

export type OAuthProviderOptions = {
  storePath?: string;
  scopes?: string[];
  clientId?: string;
  openBrowser?: (url: string) => void;
};

/** The `@ai-sdk/mcp` `OAuthClientProvider.redirectToAuthorization` contract is
 *  `(url: URL) => void | Promise<void>` — the SDK already built the full
 *  authorization URL (PKCE challenge + state baked in) and only expects the
 *  provider to present it to the user; the actual code→token exchange is
 *  driven by a *second* call to the SDK's `auth()` with `authorizationCode`
 *  set. That second call's code has to come from somewhere, so this provider
 *  exposes `waitForRedirect()` (NOT part of the `OAuthClientProvider`
 *  contract) for the Task-14 orchestration to await after it sees `auth()`
 *  return `'REDIRECT'`. */
export type LiveOAuthClientProvider = OAuthClientProvider & {
  waitForRedirect(): Promise<{ code: string; state: string }>;
};

function defaultOpenBrowser(url: string): void {
  Bun.spawn(['open', url]);
}

/** Live `OAuthClientProvider` for MCP remote servers: token/PKCE-verifier/
 *  client-registration state round-trips through the Task-10 token store
 *  (`src/mcp/token-store.ts`, keyed by `serverName`); the interactive
 *  authorization step opens a browser and captures the redirect via a
 *  loopback listener built the same way as Task-11's `awaitOAuthRedirect`
 *  (`src/mcp/loopback.ts`) — bound once per provider instance and reused for
 *  both `redirectUrl` (needed up front for client registration / the
 *  authorization URL) and the actual callback capture, since those two must
 *  agree on the same port (see task-12-report.md for why `awaitOAuthRedirect`
 *  itself isn't reused directly). */
export function createOAuthProvider(
  serverName: string,
  opts: OAuthProviderOptions = {},
): LiveOAuthClientProvider {
  const storePath = opts.storePath ?? tokenStorePath();
  const openBrowser = opts.openBrowser ?? defaultOpenBrowser;

  let server: ReturnType<typeof Bun.serve> | undefined;
  let boundPort: number | undefined;
  let pending:
    | {
        expectedState: string;
        resolve: (v: { code: string; state: string }) => void;
        reject: (e: Error) => void;
      }
    | undefined;
  let pendingPromise: Promise<{ code: string; state: string }> | undefined;

  function stopServer(): void {
    server?.stop();
    server = undefined;
    boundPort = undefined;
  }

  /** Binds the loopback listener on first use and reuses it thereafter, so
   *  the port advertised via `redirectUrl` (used for DCR + the authorization
   *  URL) is the SAME port the later callback is captured on. */
  function ensureServer(): number {
    if (server && boundPort !== undefined) return boundPort;
    server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname !== '/callback') {
          return new Response('Not found', { status: 404 });
        }
        if (!pending) {
          return new Response('Not expecting a callback', { status: 400 });
        }
        const code = url.searchParams.get('code') ?? '';
        const state = url.searchParams.get('state') ?? '';
        if (state !== pending.expectedState) {
          pending.reject(new Error('state mismatch'));
          return new Response('Bad request', { status: 400 });
        }
        if (code === '') {
          pending.reject(new Error('missing code'));
          return new Response('Bad request', { status: 400 });
        }
        pending.resolve({ code, state });
        return new Response('You may close this window', { status: 200 });
      },
    });
    if (server.port === undefined)
      throw new Error('loopback server has no bound port');
    boundPort = server.port;
    return boundPort;
  }

  function redirectUrlString(): string {
    return loopbackRedirectUri(ensureServer());
  }

  return {
    tokens(): OAuthTokens | undefined {
      const rec = getServerAuth(serverName, storePath).tokens;
      if (!rec) return undefined;
      const expires_in =
        rec.expires_at === undefined
          ? undefined
          : Math.max(0, Math.round((rec.expires_at - Date.now()) / 1000));
      return {
        access_token: rec.access_token,
        token_type: rec.token_type ?? 'Bearer',
        refresh_token: rec.refresh_token,
        expires_in,
      };
    },

    saveTokens(tokens: OAuthTokens): void {
      setServerAuth(
        serverName,
        {
          tokens: {
            access_token: tokens.access_token,
            token_type: tokens.token_type,
            refresh_token: tokens.refresh_token,
            expires_at:
              tokens.expires_in === undefined
                ? undefined
                : Date.now() + tokens.expires_in * 1000,
          },
        },
        storePath,
      );
    },

    redirectToAuthorization(url: URL): void {
      ensureServer();
      const state = url.searchParams.get('state') ?? '';
      pendingPromise = withWallClock(
        REDIRECT_WAIT_TIMEOUT_MS,
        () =>
          new Promise<{ code: string; state: string }>((resolve, reject) => {
            pending = { expectedState: state, resolve, reject };
          }),
      ).finally(stopServer);
      // Nobody may ever call waitForRedirect() (e.g. if the caller abandons
      // this flow) — never let that surface as an unhandled rejection.
      pendingPromise.catch(() => {});
      openBrowser(url.toString());
    },

    waitForRedirect(): Promise<{ code: string; state: string }> {
      if (!pendingPromise) {
        return Promise.reject(
          new Error(
            `oauth-provider(${serverName}): redirectToAuthorization has not been called yet`,
          ),
        );
      }
      return pendingPromise;
    },

    saveCodeVerifier(codeVerifier: string): void {
      setServerAuth(serverName, { codeVerifier }, storePath);
    },

    codeVerifier(): string {
      const codeVerifier = getServerAuth(serverName, storePath).codeVerifier;
      if (codeVerifier === undefined) {
        throw new Error(
          `oauth-provider(${serverName}): no code verifier stored — saveCodeVerifier must be called first`,
        );
      }
      return codeVerifier;
    },

    get redirectUrl(): string {
      return redirectUrlString();
    },

    get clientMetadata(): OAuthClientMetadata {
      return {
        client_name: CLIENT_NAME,
        redirect_uris: [redirectUrlString()],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
        scope: opts.scopes?.join(' '),
      };
    },

    clientInformation(): OAuthClientInformation | undefined {
      const client = getServerAuth(serverName, storePath).client;
      if (client)
        return {
          client_id: client.client_id,
          client_secret: client.client_secret,
        };
      if (opts.clientId) return { client_id: opts.clientId };
      return undefined; // triggers DCR/CIMD in the SDK
    },

    saveClientInformation(clientInformation: OAuthClientInformation): void {
      setServerAuth(
        serverName,
        {
          client: {
            client_id: clientInformation.client_id,
            client_secret: clientInformation.client_secret,
          },
        },
        storePath,
      );
    },
  };
}
