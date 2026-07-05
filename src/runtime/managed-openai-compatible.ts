import { createServer } from 'node:net';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { MemoryError } from '../core/errors.ts';
import type { ModelDeclaration, RuntimeKind } from '../core/types.ts';
import { breakerFor } from '../reliability/breaker.ts';
import { probeTimeoutMs } from '../reliability/config.ts';
import { withRuntimeSpan } from '../telemetry/spans.ts';
import {
  type SpawnFn,
  type SupervisedServer,
  superviseServer,
} from './process-supervisor.ts';
import type { LoadedModel, Runtime } from './runtime.ts';

/** A single entry from the OpenAI-compatible `GET /models` payload. Fields beyond
 * `id` are non-standard extensions some servers (LM Studio, vllm-mlx) add. */
export type MlxModelEntry = {
  id: string;
  max_context_length?: number;
  context_length?: number;
  max_model_len?: number;
  size_bytes?: number;
  size?: number;
};

type MlxModelsResponse = { data?: MlxModelEntry[] };

/** The context length field, if the server reports one under any known name. */
export function contextLengthOf(entry: MlxModelEntry): number | undefined {
  const v =
    entry.max_context_length ?? entry.context_length ?? entry.max_model_len;
  return typeof v === 'number' ? v : undefined;
}

/** The on-disk/in-memory size field, if the server reports one; else 0 (honest fallback). */
export function sizeBytesOf(entry: MlxModelEntry): number {
  const v = entry.size_bytes ?? entry.size;
  return typeof v === 'number' ? v : 0;
}

/** How a runtime's context window is (re)configured when `warm` requests a numCtx. */
export type ContextCapability = 'relaunch' | 'reload' | 'fixed';

export type LaunchSpec = {
  cmd: string;
  args: string[];
  env?: Record<string, string>;
  port: number;
};

/** Runtime-specific behavior the managed base delegates to. */
export type RuntimeStrategy = {
  kind: RuntimeKind;
  detect(): Promise<boolean>;
  contextCapability: ContextCapability;
  defaultPort: number;
  healthPath: string; // '/health' | '/v1/models'
  basePath?: string; // default '/v1'
  /** Spawned runtimes (llama.cpp, MLX): build the launch command for (model, numCtx, port).
   *  numCtx is applied only when contextCapability==='relaunch'. */
  launch?(model: string, numCtx: number | undefined, port: number): LaunchSpec;
  /** Daemon runtimes (LM Studio): ensure daemon + load model at ctx; returns the base URL to talk to. */
  daemonLoad?(
    model: string,
    numCtx: number | undefined,
  ): Promise<{ baseUrl: string }>;
  daemonUnload?(model: string): Promise<void>;
};

/** Binds a throwaway TCP server on port 0 and returns the OS-assigned free port. */
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

export type ManagedDeps = {
  spawn?: SpawnFn;
  fetchImpl?: typeof fetch;
  startTimeoutMs?: number;
  host?: string;
  /** Injectable port allocator; defaults to the real freePort(). Tests inject
   * a deterministic one (or never trigger a relaunch, so the default is unused). */
  portAlloc?: () => Promise<number>;
};

type CurrentServer = {
  model: string;
  numCtx: number | undefined;
  baseUrl: string;
  server?: SupervisedServer;
};

/**
 * Owns the lifecycle of a locally-managed OpenAI-compatible runtime (spawned
 * process or daemon-loaded) and delegates runtime-specific behavior (how to
 * launch, how the context window is configured, health path) to a
 * `RuntimeStrategy`. Task 4/5/6 supply strategies for llama.cpp, MLX, and
 * LM Studio; this file owns spawn/health/port/breaker plumbing exactly once.
 */
export function createManagedRuntime(
  strategy: RuntimeStrategy,
  deps: ManagedDeps = {},
): Runtime {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const host = deps.host ?? '127.0.0.1';
  const portAlloc = deps.portAlloc ?? freePort;
  const basePath = strategy.basePath ?? '/v1';
  const fallbackBaseUrl = `http://${host}:${strategy.defaultPort}${basePath}`;
  const breaker = breakerFor(`runtime:${strategy.kind}`);

  let current: CurrentServer | undefined;

  // Serializes concurrent `warm` calls on this runtime instance. The workflow
  // engine warms runtimes from parallel agent-step batches, so without this,
  // two concurrent warms race on the single `current` slot: same (model,ctx)
  // both spawn (orphaning a process/port), or different models SIGTERM each
  // other's just-spawned server mid-request. Each `warm` is chained onto the
  // tail of the queue so only one doWarm() body (reuse-check → stopCurrent →
  // portAlloc → spawn → set current) runs at a time. `warmQueue` itself never
  // rejects — it's a scheduling gate, not a result carrier — so a throwing
  // warm still releases the queue for the next caller instead of wedging it.
  let warmQueue: Promise<void> = Promise.resolve();

  function serialized<T>(fn: () => Promise<T>): Promise<T> {
    const turn = warmQueue.then(fn, fn);
    warmQueue = turn.then(
      () => undefined,
      () => undefined,
    );
    return turn;
  }

  function effectiveCtx(numCtx: number | undefined): number | undefined {
    return strategy.contextCapability === 'fixed' ? undefined : numCtx;
  }

  async function stopCurrent(): Promise<void> {
    if (!current) return;
    if (current.server) await current.server.stop();
    if (strategy.daemonUnload) await strategy.daemonUnload(current.model);
    current = undefined;
  }

  async function listModels(): Promise<MlxModelEntry[]> {
    const baseUrl = current?.baseUrl ?? fallbackBaseUrl;
    try {
      const res = await fetchImpl(`${baseUrl}/models`, {
        signal: AbortSignal.timeout(probeTimeoutMs()),
      });
      if (!res.ok) return [];
      const data = (await res.json()) as MlxModelsResponse;
      return data.data ?? [];
    } catch {
      return [];
    }
  }

  async function listIds(): Promise<string[]> {
    return (await listModels()).map((m) => m.id);
  }

  async function doWarm(model: string, numCtx?: number): Promise<void> {
    return withRuntimeSpan(strategy.kind, async (rec) => {
      const ctx = effectiveCtx(numCtx);
      // 'fixed' capability never actually applies a requested context — the
      // runtime (e.g. MLX) ignores it, so leave RUNTIME_CONTEXT_APPLIED
      // unset rather than implying a context change took effect.
      const appliedCtx =
        strategy.contextCapability === 'fixed' ? undefined : ctx;
      try {
        if (current && current.model === model && current.numCtx === ctx) {
          rec.applied(numCtx, appliedCtx, 'reused', strategy.contextCapability);
          return;
        }

        await stopCurrent();

        if (strategy.daemonLoad) {
          const { baseUrl } = await strategy.daemonLoad(model, ctx);
          current = { model, numCtx: ctx, baseUrl };
          rec.applied(
            numCtx,
            appliedCtx,
            'daemon-loaded',
            strategy.contextCapability,
          );
          return;
        }

        if (!strategy.launch) {
          throw new Error(
            `runtime strategy "${strategy.kind}" defines neither launch nor daemonLoad`,
          );
        }

        const port = await portAlloc();
        // 'fixed' capability never threads numCtx into the launcher.
        const launchCtx =
          strategy.contextCapability === 'fixed' ? undefined : ctx;
        const spec = strategy.launch(model, launchCtx, port);
        const server = await superviseServer(
          {
            cmd: spec.cmd,
            args: spec.args,
            env: spec.env,
            host,
            port: spec.port,
            basePath,
            healthPath: strategy.healthPath,
          },
          { spawn: deps.spawn, fetchImpl, startTimeoutMs: deps.startTimeoutMs },
        );
        current = { model, numCtx: ctx, baseUrl: server.baseUrl, server };
        rec.applied(numCtx, appliedCtx, 'spawned', strategy.contextCapability);
      } catch (err) {
        rec.applied(numCtx, appliedCtx, 'failed', strategy.contextCapability);
        throw err;
      }
    });
  }

  return {
    kind: strategy.kind,
    isAvailable: () => strategy.detect(),
    createModel: (decl: ModelDeclaration) =>
      createOpenAICompatible({
        name: strategy.kind,
        baseURL: current?.baseUrl ?? fallbackBaseUrl,
      })(decl.model),
    control: {
      isInstalled: async (model) => (await listIds()).includes(model),
      pull: async () => {
        throw new Error(
          `runtime "${strategy.kind}" does not manage downloads here — use the provisioning layer to pull models`,
        );
      },
      warm: (model, numCtx) =>
        breaker.run(() => serialized(() => doWarm(model, numCtx))),
      unload: async () => {
        await stopCurrent();
      },
      listLoaded: async (): Promise<LoadedModel[]> =>
        (await listModels()).map((m) => ({
          name: m.id,
          sizeBytes: sizeBytesOf(m),
        })),
      getModelMax: async (model) => {
        const entry = (await listModels()).find((e) => e.id === model);
        return entry ? contextLengthOf(entry) : undefined;
      },
      getModelKvArch: async () => undefined,
      embed: async () => {
        throw new MemoryError(
          `embeddings are not supported on the "${strategy.kind}" managed runtime`,
        );
      },
    },
  };
}
