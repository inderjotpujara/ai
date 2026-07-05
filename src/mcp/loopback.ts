import { withWallClock } from '../reliability/timeout.ts';

export type LoopbackDeps = {
  openBrowser?: (url: string) => void;
  timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 180_000;

/** `http://127.0.0.1:<port>/callback` — the loopback redirect_uri for `port`. */
export function loopbackRedirectUri(port: number): string {
  return `http://127.0.0.1:${port}/callback`;
}

function defaultOpenBrowser(url: string): void {
  Bun.spawn(['open', url]);
}

/** Start a one-shot localhost server on an ephemeral port, build the authorization
 *  URL via `buildAuthUrl(redirectUri)`, open it in the browser, and resolve with the
 *  `{code, state}` captured on the first `/callback` hit — then stop the server.
 *  A `state` mismatch rejects `Error('state mismatch')`; a missing `code` rejects
 *  `Error('missing code')`; a no-show rejects on
 *  `deps.timeoutMs` (default 180s). The server is stopped on every exit path. */
export function awaitOAuthRedirect(
  buildAuthUrl: (redirectUri: string) => string,
  expectedState: string,
  deps?: LoopbackDeps,
): Promise<{ code: string; state: string; redirectUri: string }> {
  const openBrowser = deps?.openBrowser ?? defaultOpenBrowser;
  const timeoutMs = deps?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let server: ReturnType<typeof Bun.serve> | undefined;

  return withWallClock(
    timeoutMs,
    () =>
      new Promise<{ code: string; state: string; redirectUri: string }>(
        (resolve, reject) => {
          server = Bun.serve({
            hostname: '127.0.0.1',
            port: 0,
            fetch(req) {
              const url = new URL(req.url);
              if (url.pathname !== '/callback') {
                return new Response('Not found', { status: 404 });
              }
              const code = url.searchParams.get('code') ?? '';
              const state = url.searchParams.get('state') ?? '';
              if (state !== expectedState) {
                reject(new Error('state mismatch'));
                return new Response('Bad request', { status: 400 });
              }
              if (code === '') {
                reject(new Error('missing code'));
                return new Response('Bad request', { status: 400 });
              }
              resolve({ code, state, redirectUri });
              return new Response('You may close this window', { status: 200 });
            },
          });

          if (server.port === undefined) {
            reject(new Error('loopback server has no bound port'));
            return;
          }
          const redirectUri = loopbackRedirectUri(server.port);
          const authUrl = buildAuthUrl(redirectUri);
          openBrowser(authUrl);
        },
      ),
  ).finally(() => {
    // Graceful (non-forcing) stop: lets the in-flight /callback response finish
    // sending before the socket closes, then rejects new connections and exits.
    server?.stop();
  });
}
