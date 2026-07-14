import { loadConfig } from '../config/schema.ts';
import { buildFetch, type ServerDeps } from './app.ts';
import { mintSessionToken } from './security/token.ts';

/**
 * Minimal served page for Phase 1 (no web/ build yet). The token is injected as
 * `window.__AGENT_TOKEN__` so the future frontend reads it from the served HTML
 * rather than a network round-trip. Phase 1b replaces this with the Vite build.
 */
export function renderIndexHtml(token: string): string {
  // JSON.stringify does not escape `</`, so a token value could break out of
  // the <script> tag; escape `<` to a unicode escape before interpolating.
  const safeToken = JSON.stringify(token).replace(/</g, '\\u003c');
  return (
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<title>AI Local Agent</title>' +
    `<script>window.__AGENT_TOKEN__=${safeToken};</script>` +
    '</head><body><div id="root"></div></body></html>'
  );
}

export type StartOptions = {
  port?: number;
  allowedOrigins?: string[];
  recordIo?: boolean;
  staticDir?: string;
  token?: string;
};

/** Boot the local web BFF. Returns the server handle for tests/shutdown. */
export function startWebServer(opts: StartOptions = {}): {
  server: ReturnType<typeof Bun.serve>;
  token: string;
  port: number;
} {
  const cfg = loadConfig().values;
  const port = opts.port ?? (cfg.AGENT_WEB_PORT as number);
  const allowedOrigins =
    opts.allowedOrigins ??
    String(cfg.AGENT_WEB_ORIGIN_ALLOWLIST)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  const recordIo = opts.recordIo ?? (cfg.AGENT_WEB_RECORD_IO as boolean);
  const token = opts.token ?? mintSessionToken();

  const policy = { port, allowedOrigins };
  const deps: ServerDeps = {
    token,
    policy,
    recordIo,
    staticDir: opts.staticDir,
    indexHtml: renderIndexHtml(token),
  };
  // idleTimeout: 0 is required so future SSE streams are not idle-closed.
  const server = Bun.serve({ port, fetch: buildFetch(deps), idleTimeout: 0 });
  // .port is `number | undefined` under the installed bun-types; guard with a
  // real runtime check (never `!` or a cast) before reconciling the ephemeral
  // port (port: 0) back into the perimeter policy and the return value.
  const { port: boundPort } = server;
  if (boundPort === undefined) {
    throw new Error('Bun.serve() did not report a bound port');
  }
  policy.port = boundPort; // reconcile when port === 0 (ephemeral)
  return { server, token, port: boundPort };
}

if (import.meta.main) {
  const { server } = startWebServer();
  process.stderr.write(
    `web BFF on http://localhost:${server.port} ` +
      '(session token minted + injected into served HTML)\n',
  );
}
