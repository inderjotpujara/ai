import { explain } from '../errors/boundary.ts';
import { withServerRequestSpan } from '../telemetry/spans.ts';
import { handleChat } from './chat/handler.ts';
import type { RunChatTurn } from './chat/run-turn.ts';
import type { ConsentRegistry } from './consent/registry.ts';
import { handleRespond } from './consent/respond.ts';
import { handleFeedback } from './feedback.ts';
import { ISOLATION_HEADERS } from './isolation-headers.ts';
import { handleRunDetail } from './runs/detail.ts';
import { handleRunList } from './runs/list.ts';
import { handleRunStream } from './runs/stream.ts';
import { confineToDir, MediaPathError } from './security/media-path.ts';
import { enforcePerimeter, type OriginPolicy } from './security/origin.ts';
import { createTokenGuard } from './security/token.ts';
import { handleUpload } from './upload.ts';

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
  runChatTurn: RunChatTurn;
  consent: ConsentRegistry;
  /** Durable dir confined-uploads are written to/read from (Task 16). */
  uploadsDir: string;
  /** Root dir the Runs endpoints read on-disk spans/artifacts from (Phase 3). */
  runsRoot: string;
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...ISOLATION_HEADERS,
    },
  });
}

export function buildFetch(
  deps: ServerDeps,
): (req: Request) => Promise<Response> {
  const guard = createTokenGuard(deps.token);
  return async (req) => {
    // Top-level backstop: ANY throw anywhere below (perimeter, static serving,
    // URL parsing, ...) degrades to a JSON 500, never crashes the process.
    // The /api-level try/catch in handleApi is the fast path; this is the net.
    try {
      const blocked = enforcePerimeter(req, deps.policy);
      if (blocked) return blocked;

      const url = new URL(req.url);
      if (url.pathname.startsWith('/api')) {
        if (!guard.verify(req)) return json({ error: 'unauthorized' }, 401);
        return await handleApi(req, url, deps);
      }
      return await serveStatic(req, url, deps);
    } catch (err) {
      return json({ error: explain(err).title }, 500);
    }
  };
}

async function handleApi(
  req: Request,
  url: URL,
  deps: ServerDeps,
): Promise<Response> {
  return withServerRequestSpan(
    { route: url.pathname, method: req.method },
    async (rec) => {
      try {
        if (url.pathname === '/api/health') {
          rec.status(200);
          return json({ ok: true });
        }
        if (req.method === 'POST' && url.pathname === '/api/chat') {
          rec.status(200);
          return handleChat(req, deps);
        }
        if (req.method === 'POST' && url.pathname === '/api/upload') {
          rec.status(200);
          return handleUpload(req, deps);
        }
        const respondMatch = url.pathname.match(
          /^\/api\/runs\/([^/]+)\/respond$/,
        );
        const runId = respondMatch?.[1];
        if (req.method === 'POST' && runId !== undefined) {
          rec.status(200);
          return handleRespond(req, deps, runId);
        }
        if (req.method === 'POST' && url.pathname === '/api/feedback') {
          rec.status(200);
          return handleFeedback(req);
        }
        if (req.method === 'GET' && url.pathname === '/api/runs') {
          rec.status(200);
          return handleRunList(new URLSearchParams(url.search), deps);
        }
        // Stream match MUST precede the bare-:id detail match so that
        // `/api/runs/:id/stream` opens an event-stream rather than being
        // captured as a detail lookup (which would return JSON instead).
        const streamMatch = url.pathname.match(
          /^\/api\/runs\/([^/]+)\/stream$/,
        );
        if (req.method === 'GET' && streamMatch?.[1]) {
          // handleRunStream can return a synchronous 404 (path-escaping id)
          // before it ever streams; reflect the REAL status in telemetry
          // (a 200 streaming body still reports 200).
          const res = await handleRunStream(streamMatch[1], deps, {
            lastEventId: req.headers.get('Last-Event-ID') ?? undefined,
            signal: req.signal,
          });
          rec.status(res.status);
          return res;
        }
        const detailMatch = url.pathname.match(/^\/api\/runs\/([^/]+)$/);
        if (req.method === 'GET' && detailMatch?.[1]) {
          const res = await handleRunDetail(detailMatch[1], deps);
          rec.status(res.status); // may be 404 — reflect the actual status
          return res;
        }
        rec.status(404);
        return json({ error: 'not found' }, 404);
      } catch (err) {
        // Never crash the handler: map the typed error to an actionable JSON body.
        rec.status(500);
        return json({ error: explain(err).title }, 500);
      }
    },
  );
}

const INDEX_HTML_HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'no-store',
  ...ISOLATION_HEADERS,
};

// A pathname with a trailing `.ext` (e.g. /assets/x.js, /foo.css) is treated
// as a real asset request: a miss stays a 404, never masked by the SPA
// fallback. Extensionless paths (client routes like /runs, /runs/run-x) are
// eligible for the fallback below.
const HAS_EXTENSION = /\.[a-zA-Z0-9]+$/;

async function serveStatic(
  req: Request,
  url: URL,
  deps: ServerDeps,
): Promise<Response> {
  if (url.pathname === '/' || url.pathname === '/index.html') {
    return new Response(deps.indexHtml, { headers: INDEX_HTML_HEADERS });
  }
  if (deps.staticDir) {
    try {
      // Strip the leading slash(es): confineToDir's resolve(root, candidate)
      // treats a leading-slash candidate as its OWN absolute path (bypassing
      // root entirely), so a bare pathname like "/hello.txt" must become the
      // relative "hello.txt" to join under staticDir. confineToDir then
      // resolves symlinks/`..`/absolute-escape candidates and throws
      // MediaPathError for anything outside staticDir — including a
      // merely-missing file, which is fine: both fall through to the plain
      // 404 below without leaking which case it was.
      const candidate = url.pathname.replace(/^\/+/, '');
      const real = confineToDir(candidate, deps.staticDir);
      const file = Bun.file(real);
      if (await file.exists()) {
        return new Response(file, { headers: { ...ISOLATION_HEADERS } });
      }
    } catch (err) {
      if (!(err instanceof MediaPathError)) throw err;
    }
  }
  // SPA fallback: a GET/HEAD to an extensionless path that matched no real
  // file is a client-router route (e.g. /runs, /runs/:id) being hard-loaded,
  // reloaded, or deep-linked — boot the app instead of 404ing so the router
  // can resolve it client-side. Non-GET/HEAD and asset-looking (has an
  // extension) paths never get this treatment.
  if (
    (req.method === 'GET' || req.method === 'HEAD') &&
    !HAS_EXTENSION.test(url.pathname)
  ) {
    return new Response(deps.indexHtml, { headers: INDEX_HTML_HEADERS });
  }
  return new Response('not found', {
    status: 404,
    headers: { ...ISOLATION_HEADERS },
  });
}
