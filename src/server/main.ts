import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { getCrew } from '../../crews/index.ts';
import { getWorkflow } from '../../workflows/index.ts';
import { loadConfig } from '../config/schema.ts';
import { RuntimeKind } from '../core/types.ts';
import { defaultPidPath } from '../daemon/pid.ts';
import { defaultConfigPath } from '../mcp/config.ts';
import { makeEmbedder, probeEmbedder } from '../memory/embed.ts';
import { makeCrossEncoderReranker } from '../memory/reranker.ts';
import { createMemoryStore } from '../memory/store.ts';
import { onShutdown } from '../process/lifecycle.ts';
import { freeDiskBytes } from '../provisioning/cli-deps.ts';
import { computeConcurrency } from '../queue/concurrency.ts';
import { createWorkerPool, type WorkerPool } from '../queue/pool.ts';
import { createJobStore, type JobStore } from '../queue/store.ts';
import { createModelManager } from '../resource/model-manager.ts';
import { runtimeFor } from '../runtime/registry.ts';
import { createSessionStore } from '../session/store.ts';
import { buildFetch, type ServerDeps } from './app.ts';
import { createLazyEngine, createRealRunChatTurn } from './chat/run-turn.ts';
import { createDurableConsentRegistry } from './consent/durable-registry.ts';
import { createJobDispatch } from './jobs/dispatch.ts';
import {
  createRealRunBuilderTurn,
  createRealRunCrewTurn,
  createRealRunModelPull,
  createRealRunWorkflowTurn,
} from './launch-turns.ts';
import { createRealMcpMountOne } from './mcp/mount-one.ts';
import { createMcpMountStatus } from './mcp/mount-status.ts';
import { createProcessRunLimiter } from './run-rate.ts';
import {
  createRootTokenStore,
  defaultRootTokenPath,
} from './security/root-token.ts';
import {
  createSessionTokenStore,
  defaultRevocationPath,
  type SessionTokenStore,
} from './security/session-token.ts';

// The built web/ SPA (`cd web && bun run build`) lands at web/dist/, two
// directories up from this file (src/server/ -> src/ -> repo root).
const WEB_DIST_DIR = join(import.meta.dir, '..', '..', 'web', 'dist');
const WEB_DIST_INDEX_PATH = join(WEB_DIST_DIR, 'index.html');

/**
 * Reads the built web/dist/index.html, if it exists. Returns undefined (never
 * throws) when the web/ app hasn't been built yet, so callers can cleanly
 * fall back to the Phase-1 stub — keeps unbuilt/Ollama-free dev + tests
 * working without a `web/dist` present.
 */
function readWebDistIndexHtml(): string | undefined {
  try {
    if (existsSync(WEB_DIST_INDEX_PATH)) {
      return readFileSync(WEB_DIST_INDEX_PATH, 'utf8');
    }
  } catch {
    // Fall through to the stub — a partially-written/unreadable dist index
    // should never crash server boot.
  }
  return undefined;
}

// Matches the built SPA's ES module entry script tag, e.g.
// `<script type="module" crossorigin src="/assets/index-XXXX.js"></script>`.
const MODULE_SCRIPT_TAG = /<script\s+type="module"[^>]*>/i;

/**
 * Served index page. When `distIndexHtml` (the built web/dist/index.html) is
 * given, the session token is injected as a `<script>` into its `<head>`,
 * BEFORE the bundle's module script tag, so `window.__AGENT_TOKEN__` is
 * defined before the app script runs — all of the dist HTML's existing tags
 * (module script + stylesheet link) are preserved untouched. Without a dist
 * index (the app hasn't been built), falls back to the minimal Phase-1 stub
 * page used by Ollama-free/unbuilt dev and tests.
 */
export type NotifyConfig = { pollMs: number; minDurationMs: number };

const DEFAULT_NOTIFY_CONFIG: NotifyConfig = {
  pollMs: 5_000,
  minDurationMs: 60_000,
};

export type VoiceWindowConfig = { defaultModel: string; vadSilenceMs: number };

const DEFAULT_VOICE_CONFIG: VoiceWindowConfig = {
  defaultModel: 'moonshine-base',
  vadSilenceMs: 800,
};

export function renderIndexHtml(
  token: string,
  distIndexHtml?: string,
  notify: NotifyConfig = DEFAULT_NOTIFY_CONFIG,
  voice: VoiceWindowConfig = DEFAULT_VOICE_CONFIG,
): string {
  // JSON.stringify does not escape `</`, so a value could break out of the
  // <script> tag; escape `<` to a unicode escape before interpolating. Every
  // interpolation below MUST route through this helper — routing them all
  // through one shared function (rather than inlining `.replace(/</g, ...)`
  // at each call site) means the escaping can't silently drift out of sync
  // as new globals are added (it did for `voice.defaultModel`, a STRING
  // value, before this fix — the numeric globals were never at risk).
  const safeJson = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c');
  const tokenScript =
    `<script>window.__AGENT_TOKEN__=${safeJson(token)};` +
    `window.__AGENT_NOTIFY_POLL_MS__=${safeJson(notify.pollMs)};` +
    `window.__AGENT_NOTIFY_MIN_DURATION_MS__=${safeJson(notify.minDurationMs)};` +
    `window.__AGENT_VOICE_DEFAULT_MODEL__=${safeJson(voice.defaultModel)};` +
    `window.__AGENT_VOICE_VAD_SILENCE_MS__=${safeJson(voice.vadSilenceMs)};</script>`;
  if (distIndexHtml !== undefined) {
    if (MODULE_SCRIPT_TAG.test(distIndexHtml)) {
      return distIndexHtml.replace(
        MODULE_SCRIPT_TAG,
        (match) => tokenScript + match,
      );
    }
    // No module script found (unexpected build output shape) — still inject
    // into <head> so the token is available, rather than silently dropping it.
    return distIndexHtml.replace(
      /<head(\s[^>]*)?>/i,
      (match) => match + tokenScript,
    );
  }
  return (
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<title>AI Local Agent</title>' +
    tokenScript +
    '</head><body><div id="root"></div></body></html>'
  );
}

export type StartOptions = {
  port?: number;
  /** Hostname/interface Bun.serve binds (Slice 24 Incr 5, item 5). Defaults to
   *  `AGENT_WEB_BIND` (127.0.0.1, loopback-only — no implicit 0.0.0.0). The
   *  Tailscale tunnel recipe overrides this to the 100.x tailnet interface. */
  bind?: string;
  allowedOrigins?: string[];
  /** Extra Host-header hostnames allowed past the DNS-rebinding Host check
   *  beyond loopback (Slice 24 Incr 5, item 5/12/13). Defaults to the bind
   *  interface + `AGENT_WEB_ALLOWED_HOSTS` (the tunnel host). Empty =
   *  loopback-only (default-safe). */
  allowedHosts?: string[];
  recordIo?: boolean;
  staticDir?: string;
  /** LEGACY escape hatch: a raw constant bearer. When set, the durable
   *  root→session auth is bypassed and the server uses the constant-token
   *  guard. Production/daemon boot never sets it (durable auth is built below);
   *  it exists only for narrow fixtures that still want a fixed token. */
  token?: string;
  /** Path of the durable daemon root token (security/root-token.ts). Defaults
   *  to `~/.agent/daemon-token`; overridable so tests stay hermetic. */
  rootTokenPath?: string;
  /** Path of the per-device revocation set (security/session-token.ts).
   *  Defaults to `~/.agent/revoked-devices.json`; overridable for tests. */
  sessionRevocationPath?: string;
  /** TTL (ms) of the local-browser session token. Defaults to
   *  `AGENT_WEB_SESSION_TTL_MS`. */
  sessionTtlMs?: number;
  /** Inject a pre-built session-token store (e.g. the daemon's single live
   *  instance, so revoke/rotate operate on the SAME store the guard verifies).
   *  Absent = build one from the root store below. */
  sessionTokens?: SessionTokenStore;
  /** Injected, pre-reconciled queue owned by the caller (the daemon, T27). When
   *  present, startWebServer does NOT construct or start/stop a pool — the
   *  caller already ran reconcileOrphans() then pool.start() in the correct
   *  §7.3 order and owns the drain. Absent = standalone: startWebServer
   *  self-hosts one pool (`bun run web` / all-in-one tests). Running a second
   *  pool on the same AGENT_QUEUE_PATH DB would double concurrency and bypass
   *  the reconcile-before-claim guarantee — the bug this dual mode closes.
   *  `concurrency` (Slice 25b Task 11) is the SAME `computeConcurrency()` value
   *  the caller built `pool` with — threaded through so `/api/queue/stats`
   *  (T8) and `/api/daemon/status` never report a number that disagrees with
   *  the pool actually draining jobs. Required (not re-derived here) so this
   *  file can never call `computeConcurrency()` a second time and silently
   *  diverge from the daemon's own value. */
  queue?: { jobStore: JobStore; pool: WorkerPool; concurrency: number };
  /** Daemon pid-file path (Slice 25b Task 11), surfaced on `ServerDeps.daemonPidPath`
   *  for `/api/daemon/status`'s uptime-from-mtime read. Defaults to the same
   *  `defaultPidPath()` the daemon itself writes (`daemon/pid.ts`), so standalone
   *  boot and daemon-injected boot report the identical path unless a test
   *  overrides it. */
  daemonPidPath?: string;
  /** Directory holding `agent.{out,err}.log` (Slice 25b Task 11), surfaced on
   *  `ServerDeps.daemonLogDir` for `/api/daemon/logs`. Defaults to the sibling
   *  `logs/` dir next to the pid file — the SAME directory `defaultLogDir()`
   *  in `src/cli/daemon.ts` resolves to (kept as two independent expressions
   *  of the same default rather than a shared import, since `cli/daemon.ts`'s
   *  version isn't exported; both derive from `defaultPidPath()`). */
  daemonLogDir?: string;
};

/** Boot the local web BFF. Returns the server handle for tests/shutdown. */
export function startWebServer(opts: StartOptions = {}): {
  server: ReturnType<typeof Bun.serve>;
  token: string;
  port: number;
  jobStore: JobStore;
  pool: WorkerPool;
} {
  const cfg = loadConfig().values;
  const port = opts.port ?? (cfg.AGENT_WEB_PORT as number);
  const allowedOrigins =
    opts.allowedOrigins ??
    String(cfg.AGENT_WEB_ORIGIN_ALLOWLIST)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  // The interface Bun.serve binds; also always allowed as a Host so a request
  // to the bound interface (e.g. a 100.x tailnet IP) passes the perimeter.
  const bind = opts.bind ?? String(cfg.AGENT_WEB_BIND);
  // Extra Host-header hosts past the loopback DNS-rebinding check (item 5/12/13):
  // the bind interface + the configured tunnel host(s). Empty (default) keeps
  // today's localhost-only perimeter — remote reach is an explicit opt-in.
  const allowedHosts =
    opts.allowedHosts ??
    [bind, ...String(cfg.AGENT_WEB_ALLOWED_HOSTS).split(',')]
      .map((s) => s.trim())
      .filter(Boolean);
  const recordIo = opts.recordIo ?? (cfg.AGENT_WEB_RECORD_IO as boolean);

  // Durable auth (Slice 24 Incr 5, D4): ONE root + ONE live session-token store
  // per server. The root is minted-once + persisted (~/.agent/daemon-token), so
  // auth survives restarts; a reconnecting device stays authorized without a
  // re-pair. The session store is the SINGLE instance the guard verifies
  // against, so an in-process revoke/rotate takes effect immediately (nit #2).
  // For the localhost browser we mint a SESSION token for the `'local'` device
  // (short TTL) and inject THAT as window.__AGENT_TOKEN__ — the root NEVER
  // leaves the server (nit #6). `opts.token` is a legacy bypass only.
  let sessionTokens: SessionTokenStore | undefined;
  let token: string;
  if (opts.token !== undefined) {
    token = opts.token; // legacy constant-token fixture path
  } else if (opts.sessionTokens) {
    sessionTokens = opts.sessionTokens; // caller (daemon) owns the live store
    token = sessionTokens.mintSessionToken({
      deviceId: 'local',
      ttlMs: opts.sessionTtlMs ?? (cfg.AGENT_WEB_SESSION_TTL_MS as number),
    });
  } else {
    const rootStore = createRootTokenStore({
      path: opts.rootTokenPath ?? defaultRootTokenPath(),
    });
    sessionTokens = createSessionTokenStore({
      path: opts.sessionRevocationPath ?? defaultRevocationPath(),
      rootToken: rootStore.getOrCreateRoot(),
    });
    token = sessionTokens.mintSessionToken({
      deviceId: 'local',
      ttlMs: opts.sessionTtlMs ?? (cfg.AGENT_WEB_SESSION_TTL_MS as number),
    });
  }

  const policy = { port, allowedOrigins, allowedHosts };
  // Bind posture surfaced on `ServerDeps.bindInfo` for the Overview/Devices
  // tabs (Slice 25b Task 11). A separate mutable local (not inlined into
  // `deps` below) mirrors `policy` just above: `port` is reconciled to the
  // real bound port after `Bun.serve()` resolves an ephemeral `port: 0`.
  const bindInfo = {
    bind,
    allowedHosts,
    port,
    sessionTtlMs: opts.sessionTtlMs ?? (cfg.AGENT_WEB_SESSION_TTL_MS as number),
  };
  // Honor AGENT_RUNS_ROOT (same expression as the CLI runs/usage/archive
  // readers, src/cli/{runs,usage,archive}.ts) so the server writer and those
  // readers agree — never hardcode the path (repo no-hardcode rule).
  const runsRoot = process.env.AGENT_RUNS_ROOT ?? 'runs';
  // ONE process-shared limiter (Slice 24 Incr 5, item 2): gates run-dir
  // creation across ALL FOUR run-launch routes (jobs/crews/workflows/pull) so
  // a client (now potentially remote) can't spam createRun — see
  // server/run-rate.ts. Built once here so the routes share one window/count.
  const runLimiter = createProcessRunLimiter();
  const runCrewTurn = createRealRunCrewTurn(runsRoot);
  const runWorkflowTurn = createRealRunWorkflowTurn(runsRoot);
  const runBuilderTurn = createRealRunBuilderTurn(runsRoot);
  const runModelPull = createRealRunModelPull(runsRoot);
  const mcpConfigPath = defaultConfigPath();
  const mcpMountStatus = createMcpMountStatus();
  const mountOne = createRealMcpMountOne();
  // Durable consent (Task 42): pending approval prompts persist under the runs
  // root (OUTSIDE any per-run dir, like `_uploads` below) so a prompt awaiting
  // an answer survives a daemon restart — `POST /api/runs/:id/respond` can still
  // resolve it after a crash+restart, instead of it being lost with the process.
  const consent = createDurableConsentRegistry({
    path: join(runsRoot, '_consent', 'consent.json'),
  });
  // A durable dir OUTSIDE any per-run dir (Task 16): uploads must survive
  // across the per-request `/api/chat` run lifecycle since the upload and
  // the chat turn that references it are two separate HTTP requests.
  const uploadsDir = join(runsRoot, '_uploads');
  // Create it up front — before any upload ever happens — so the READ side
  // (`handleChat`'s `confineToDir(uploadId, uploadsDir)`) never hits a
  // nonexistent ROOT. `confineToDir` calls `realpathSync` on the root itself;
  // if the dir doesn't exist yet, that throws a raw `ENOENT` (not
  // `MediaPathError`), which `handleChat` doesn't catch, producing a 500
  // instead of the intended 400 for a bogus uploadId. `handleUpload` also
  // mkdirs this dir before writing (the write path was already safe); this
  // covers the read path too.
  mkdirSync(uploadsDir, { recursive: true });
  // Mirrors src/cli/memory.ts's makeRealStore — one embedder instance shared
  // by embedTexts/embedQuery, the Ollama-backed model manager for
  // ensureReady, cross-encoder rerank on by default (defaultRerank() in
  // retrieve.ts still gates actual use behind AGENT_MEMORY_RERANK).
  const memoryEmbedModel =
    process.env.AGENT_MEMORY_EMBED_MODEL ?? 'qwen3-embedding:0.6b';
  const memoryManager = createModelManager();
  const memoryEmbedder = makeEmbedder({
    ensureReady: (decl) => memoryManager.ensureReady(decl),
    control: runtimeFor(RuntimeKind.Ollama).control,
    model: memoryEmbedModel,
  });
  const memoryStore = createMemoryStore(
    { embedModel: memoryEmbedModel },
    {
      embedTexts: memoryEmbedder.embed,
      embedQuery: async (text) =>
        (await memoryEmbedder.embed([text]))[0] as number[],
      probe: probeEmbedder,
      reranker: makeCrossEncoderReranker(),
    },
  );
  // Cheap + synchronous, mirroring memoryStore's own construction discipline
  // just above (SqliteStore's constructor runs mkdirSync + opens the db +
  // migrates — no Ollama/network dependency at construction time).
  const sessionStore = createSessionStore(
    { path: String(cfg.AGENT_SESSIONS_PATH) },
    {},
  );
  // Lazy engine: nothing (registry build, model manager, MCP mount) runs at
  // boot — only on the FIRST `/api/chat` request — so server startup and the
  // perimeter/health tests stay Ollama-free. `memoryStore` threads through so
  // `runChatSession`'s `injectRecall` call (Slice 30b Phase 6, D5) gets the
  // SAME store instance the auto-ingest write path (below) uses.
  const runChatTurn = createRealRunChatTurn(
    createLazyEngine(runsRoot),
    memoryStore,
  );
  // §7.3 double-pool fix (T17 C1 seam): inject the caller's reconciled queue
  // when given; otherwise self-host one. NEVER run two pools on the same
  // AGENT_QUEUE_PATH DB. In injected mode the daemon (T27) already ran
  // reconcileOrphans() -> pool.start() in order and owns stop()/close(), so we
  // must NOT start/stop/close here. In standalone mode we own the full
  // lifecycle: construct, start, and tear down on shutdown.
  const injected = opts.queue;
  const jobStore =
    injected?.jobStore ??
    createJobStore({ path: String(cfg.AGENT_QUEUE_PATH) }, {});
  let pool: WorkerPool;
  // Worker-pool concurrency surfaced on the Overview queue card (T8's
  // /api/queue/stats) and the daemon status card. In standalone mode we own
  // the pool and thread the exact value it was built with; in injected
  // (daemon) mode the daemon owns the pool and passes ITS OWN
  // `computeConcurrency()` value through `injected.concurrency` (T11) — this
  // file never calls `computeConcurrency()` in that branch, so the reported
  // number and the pool's real concurrency can never diverge.
  let queueConcurrency: number;
  if (injected) {
    // Caller (daemon) owns lifecycle: do NOT start/stop or close here.
    pool = injected.pool;
    queueConcurrency = injected.concurrency;
  } else {
    const dispatch = createJobDispatch({
      runCrewTurn,
      getCrew,
      runWorkflowTurn,
      getWorkflow,
      runModelPull,
      runChatTurn,
      runBuilderTurn,
      runsRoot,
    });
    queueConcurrency = computeConcurrency();
    pool = createWorkerPool({
      store: jobStore,
      concurrency: queueConcurrency,
      dispatch,
      pollMs: cfg.AGENT_QUEUE_POLL_MS as number,
    });
    pool.start();
    onShutdown(async () => {
      await pool.stop();
      jobStore.close();
    });
  }
  // Serve the real built app when it exists (`cd web && bun run build`);
  // fall back to the Phase-1 stub otherwise (unbuilt/Ollama-free dev + tests).
  const distIndexHtml = readWebDistIndexHtml();
  const staticDir =
    opts.staticDir ?? (existsSync(WEB_DIST_DIR) ? WEB_DIST_DIR : undefined);

  const deps: ServerDeps = {
    token,
    sessionTokens,
    policy,
    recordIo,
    staticDir,
    indexHtml: renderIndexHtml(
      token,
      distIndexHtml,
      {
        pollMs: cfg.AGENT_WEB_NOTIFY_POLL_MS as number,
        minDurationMs: cfg.AGENT_WEB_NOTIFY_MIN_DURATION_MS as number,
      },
      {
        defaultModel: cfg.AGENT_WEB_VOICE_DEFAULT_MODEL as string,
        vadSilenceMs: cfg.AGENT_WEB_VOICE_VAD_SILENCE_MS as number,
      },
    ),
    runChatTurn,
    consent,
    uploadsDir,
    runsRoot,
    runCrewTurn,
    runWorkflowTurn,
    runBuilderTurn,
    runModelPull,
    freeDiskBytes,
    mcpConfigPath,
    mcpMountStatus,
    mountOne,
    memoryStore,
    sessionStore,
    jobStore,
    pool,
    runLimiter,
    queueConcurrency,
    daemonPidPath: opts.daemonPidPath ?? defaultPidPath(),
    bindInfo,
    daemonLogDir: opts.daemonLogDir ?? join(dirname(defaultPidPath()), 'logs'),
  };
  // idleTimeout: 0 is required so future SSE streams are not idle-closed.
  // maxRequestBodySize (Slice 24 Incr 5, item 3): Bun's own default is 128MB
  // process-wide; tighten it via config so an over-cap body is rejected with
  // 413 at the runtime layer, before the fetch handler (and any parsing) ever
  // runs. The per-route upload cap (MAX_UPLOAD_BYTES, upload.ts) is unchanged
  // and stricter still — this is the outer, global backstop.
  // hostname (Slice 24 Incr 5, item 5): with no hostname, Bun.serve binds the
  // implicit 0.0.0.0 (all interfaces) — "localhost is not a trust boundary".
  // Thread the configured bind address through instead, defaulting to
  // AGENT_WEB_BIND (127.0.0.1, loopback-only); the Tailscale tunnel recipe
  // opts in to a wider interface explicitly via `opts.bind`/the env override.
  const server = Bun.serve({
    port,
    hostname: bind,
    fetch: buildFetch(deps),
    idleTimeout: 0,
    maxRequestBodySize: cfg.AGENT_WEB_MAX_BODY_BYTES as number,
  });
  // .port is `number | undefined` under the installed bun-types; guard with a
  // real runtime check (never `!` or a cast) before reconciling the ephemeral
  // port (port: 0) back into the perimeter policy and the return value.
  const { port: boundPort } = server;
  if (boundPort === undefined) {
    throw new Error('Bun.serve() did not report a bound port');
  }
  policy.port = boundPort; // reconcile when port === 0 (ephemeral)
  bindInfo.port = boundPort; // same reconcile for the daemon-status DTO
  return { server, token, port: boundPort, jobStore, pool };
}

if (import.meta.main) {
  const { server } = startWebServer();
  process.stderr.write(
    `web BFF on http://localhost:${server.port} ` +
      '(session token minted + injected into served HTML)\n',
  );
}
