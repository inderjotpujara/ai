import { explain } from '../errors/boundary.ts';
import type { MemoryStore } from '../memory/store.ts';
import type { SessionStore } from '../session/store.ts';
import { withServerRequestSpan } from '../telemetry/spans.ts';
import type { RunBuilderTurn } from './builders/build.ts';
import { handleBuilderBuild } from './builders/build.ts';
import {
  handleBuilderAgentList,
  handleBuilderCrewList,
} from './builders/list.ts';
import { handleChat } from './chat/handler.ts';
import type { RunChatTurn } from './chat/run-turn.ts';
import type { ConsentRegistry } from './consent/registry.ts';
import { handleRespond } from './consent/respond.ts';
import { handleCrewDetail } from './crews/detail.ts';
import { handleCrewList } from './crews/list.ts';
import type { RunCrewTurn } from './crews/run.ts';
import { handleCrewRun } from './crews/run.ts';
import { handleFeedback } from './feedback.ts';
import { ISOLATION_HEADERS } from './isolation-headers.ts';
import { handleMcpAdd } from './mcp/add.ts';
import { handleMcpList } from './mcp/list.ts';
import type { McpMountOne } from './mcp/mount-one.ts';
import type { McpMountStatus } from './mcp/mount-status.ts';
import { handleMcpTestMount } from './mcp/test-mount.ts';
import { handleMemoryIngest } from './memory/ingest.ts';
import { handleMemoryRecall } from './memory/recall.ts';
import { handleMemorySpaces } from './memory/spaces.ts';
import { handleModelList } from './models/list.ts';
import type { RunModelPullTurn } from './models/pull.ts';
import { handleModelPull } from './models/pull.ts';
import { handleRunDetail } from './runs/detail.ts';
import { handleRunList } from './runs/list.ts';
import { handleRunStream } from './runs/stream.ts';
import { confineToDir, MediaPathError } from './security/media-path.ts';
import { enforcePerimeter, type OriginPolicy } from './security/origin.ts';
import { createTokenGuard } from './security/token.ts';
import { handleSessionDelete } from './sessions/delete.ts';
import { handleSessionDetail } from './sessions/detail.ts';
import { handleSessionExport } from './sessions/export.ts';
import { handleSessionList } from './sessions/list.ts';
import { handleSessionRename } from './sessions/rename.ts';
import { handleUpload } from './upload.ts';
import { handleWorkflowDetail } from './workflows/detail.ts';
import { handleWorkflowList } from './workflows/list.ts';
import type { RunWorkflowTurn } from './workflows/run.ts';
import { handleWorkflowRun } from './workflows/run.ts';

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
  /** Launches a crew run to completion under its own `withMcpRun` scope
   *  (Phase 4, Task 11/12). */
  runCrewTurn: RunCrewTurn;
  /** Launches a workflow run to completion under its own `withMcpRun` scope
   *  (Phase 4, Task 11/12). */
  runWorkflowTurn: RunWorkflowTurn;
  /** Launches the agent/crew/workflow guided-build flow (Phase 5, Task 11/12). */
  runBuilderTurn: RunBuilderTurn;
  /** Launches a model download to completion (Phase 5, Task 17). */
  runModelPull: RunModelPullTurn;
  /** Free-disk-space probe for the Models inventory route (Task 16). */
  freeDiskBytes: () => Promise<number>;
  /** `mcp.json` path this process reads/writes (Phase 5). */
  mcpConfigPath: string;
  /** Addressable, in-memory mount-attempt snapshot, keyed by server name (Phase 5). */
  mcpMountStatus: McpMountStatus;
  /** Mounts ONE MCP server to verify it works (Phase 5's D10 gap-closure seam).
   *  Named `mountOne` (not `mcpMountOne`) to match `McpTestMountDeps` exactly —
   *  `handleMcpTestMount` is called with the full `deps` object below, so its
   *  field name must line up structurally like `runsRoot`/`runCrewTurn` do for
   *  the crew/workflow routes. */
  mountOne: McpMountOne;
  /** The memory/RAG store engine-touching routes call into (Phase 5). */
  memoryStore: MemoryStore;
  /** The session/chat-history store chat persistence + the Sessions UI read
   *  and write through (Slice 30b Phase 6). */
  sessionStore: SessionStore;
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
        if (req.method === 'GET' && url.pathname === '/api/crews') {
          rec.status(200);
          return handleCrewList();
        }
        if (req.method === 'GET' && url.pathname === '/api/workflows') {
          rec.status(200);
          return handleWorkflowList();
        }
        if (req.method === 'GET' && url.pathname === '/api/builders/agents') {
          rec.status(200);
          return handleBuilderAgentList();
        }
        if (req.method === 'GET' && url.pathname === '/api/builders/crews') {
          rec.status(200);
          return handleBuilderCrewList();
        }
        if (req.method === 'POST' && url.pathname === '/api/builders/build') {
          rec.status(200);
          return handleBuilderBuild(req, deps);
        }
        if (req.method === 'GET' && url.pathname === '/api/models') {
          rec.status(200);
          return handleModelList({ freeDiskBytes: deps.freeDiskBytes });
        }
        if (req.method === 'POST' && url.pathname === '/api/models/pull') {
          rec.status(200);
          return handleModelPull(req, {
            runsRoot: deps.runsRoot,
            runModelPull: deps.runModelPull,
          });
        }
        // /run sub-path matches MUST precede the bare-:name/:id detail
        // matches below — same ordering discipline as the stream-before-
        // detail rule above (Task 10), applied to the launch routes.
        const crewRun = url.pathname.match(/^\/api\/crews\/([^/]+)\/run$/);
        if (req.method === 'POST' && crewRun?.[1]) {
          const res = await handleCrewRun(req, deps, crewRun[1]);
          rec.status(res.status);
          return res;
        }
        const wfRun = url.pathname.match(/^\/api\/workflows\/([^/]+)\/run$/);
        if (req.method === 'POST' && wfRun?.[1]) {
          const res = await handleWorkflowRun(req, deps, wfRun[1]);
          rec.status(res.status);
          return res;
        }
        const crewDetail = url.pathname.match(/^\/api\/crews\/([^/]+)$/);
        if (req.method === 'GET' && crewDetail?.[1]) {
          const res = handleCrewDetail(crewDetail[1]);
          rec.status(res.status);
          return res;
        }
        const wfDetail = url.pathname.match(/^\/api\/workflows\/([^/]+)$/);
        if (req.method === 'GET' && wfDetail?.[1]) {
          const res = handleWorkflowDetail(wfDetail[1]);
          rec.status(res.status);
          return res;
        }
        if (req.method === 'GET' && url.pathname === '/api/mcp') {
          rec.status(200);
          return handleMcpList(deps);
        }
        if (req.method === 'POST' && url.pathname === '/api/mcp/add') {
          const res = await handleMcpAdd(req, deps);
          rec.status(res.status);
          return res;
        }
        if (req.method === 'POST' && url.pathname === '/api/mcp/test-mount') {
          const res = await handleMcpTestMount(req, deps);
          rec.status(res.status);
          return res;
        }
        if (req.method === 'GET' && url.pathname === '/api/memory/spaces') {
          rec.status(200);
          return handleMemorySpaces(deps);
        }
        // Checked as an exact match BEFORE the :space regexes below, so a
        // literal space named "spaces" is unreachable via /recall/ingest
        // sub-paths only — never a collision here since "spaces" has no
        // further sub-path of its own.
        const memRecall = url.pathname.match(
          /^\/api\/memory\/([^/]+)\/recall$/,
        );
        if (req.method === 'POST' && memRecall?.[1]) {
          const res = await handleMemoryRecall(req, deps, memRecall[1]);
          rec.status(res.status);
          return res;
        }
        const memIngest = url.pathname.match(
          /^\/api\/memory\/([^/]+)\/ingest$/,
        );
        if (req.method === 'POST' && memIngest?.[1]) {
          const res = await handleMemoryIngest(req, deps, memIngest[1]);
          rec.status(res.status);
          return res;
        }
        if (req.method === 'GET' && url.pathname === '/api/sessions') {
          rec.status(200);
          return handleSessionList(new URLSearchParams(url.search), deps);
        }
        // Export match MUST precede the bare-:id detail/rename/delete match,
        // same ordering discipline as `/api/runs/:id/stream` vs
        // `/api/runs/:id` above — otherwise the bare-:id regex below would
        // swallow "export" as a session id.
        const sessionExportMatch = url.pathname.match(
          /^\/api\/sessions\/([^/]+)\/export$/,
        );
        if (req.method === 'GET' && sessionExportMatch?.[1]) {
          const res = await handleSessionExport(sessionExportMatch[1], deps);
          rec.status(res.status);
          return res;
        }
        // Bare-:id match shared by GET/PATCH/DELETE.
        const sessionDetail = url.pathname.match(/^\/api\/sessions\/([^/]+)$/);
        if (req.method === 'GET' && sessionDetail?.[1]) {
          const res = handleSessionDetail(sessionDetail[1], deps);
          rec.status(res.status);
          return res;
        }
        if (req.method === 'PATCH' && sessionDetail?.[1]) {
          const res = await handleSessionRename(req, deps, sessionDetail[1]);
          rec.status(res.status);
          return res;
        }
        if (req.method === 'DELETE' && sessionDetail?.[1]) {
          const res = handleSessionDelete(deps, sessionDetail[1]);
          rec.status(res.status);
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
