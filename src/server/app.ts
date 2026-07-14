import { join } from 'node:path';
import { explain } from '../errors/boundary.ts';
import { withServerRequestSpan } from '../telemetry/spans.ts';
import { type OriginPolicy, enforcePerimeter } from './security/origin.ts';
import { createTokenGuard } from './security/token.ts';

/**
 * The thin BFF's dependencies. It owns NO business logic: it enforces the
 * perimeter, checks the token, routes, and maps typed errors to JSON. Engine
 * wiring (chat/runs/crews/…) attaches in later phases.
 */
export type ServerDeps = {
  token: string;
  policy: OriginPolicy;
  staticDir?: string;
  recordIo: boolean;
  indexHtml: string;
};

/** COOP/COEP so the frontend can later use sherpa WASM SharedArrayBuffer. */
const ISOLATION_HEADERS: Record<string, string> = {
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-embedder-policy': 'require-corp',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...ISOLATION_HEADERS },
  });
}

export function buildFetch(deps: ServerDeps): (req: Request) => Promise<Response> {
  const guard = createTokenGuard(deps.token);
  return async (req) => {
    const blocked = enforcePerimeter(req, deps.policy);
    if (blocked) return blocked;

    const url = new URL(req.url);
    if (url.pathname.startsWith('/api')) {
      if (!guard.verify(req)) return json({ error: 'unauthorized' }, 401);
      return handleApi(req, url);
    }
    return serveStatic(url, deps);
  };
}

async function handleApi(req: Request, url: URL): Promise<Response> {
  return withServerRequestSpan({ route: url.pathname, method: req.method }, async (rec) => {
    try {
      if (url.pathname === '/api/health') {
        rec.status(200);
        return json({ ok: true });
      }
      rec.status(404);
      return json({ error: 'not found' }, 404);
    } catch (err) {
      // Never crash the handler: map the typed error to an actionable JSON body.
      rec.status(500);
      return json({ error: explain(err).title }, 500);
    }
  });
}

async function serveStatic(url: URL, deps: ServerDeps): Promise<Response> {
  if (url.pathname === '/' || url.pathname === '/index.html') {
    return new Response(deps.indexHtml, {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        ...ISOLATION_HEADERS,
      },
    });
  }
  // Reject traversal before any filesystem touch.
  if (deps.staticDir && !url.pathname.includes('..')) {
    const file = Bun.file(join(deps.staticDir, url.pathname));
    if (await file.exists()) {
      return new Response(file, { headers: { ...ISOLATION_HEADERS } });
    }
  }
  return new Response('not found', { status: 404, headers: { ...ISOLATION_HEADERS } });
}
