import { LMStudioClient } from '@lmstudio/sdk';
import { RuntimeKind } from '../../core/types.ts';
import { probeTimeoutMs } from '../../reliability/config.ts';
import {
  createManagedRuntime,
  type RuntimeStrategy,
} from '../managed-openai-compatible.ts';
import type { Runtime } from '../runtime.ts';

/** Injectable seam over `@lmstudio/sdk` so tests use a fake client — no real
 * LM Studio install/daemon needed. The real client (below) is the only place
 * that touches the SDK; keep it that way if the SDK's API shifts. */
export type LmStudioClient = {
  load(model: string, ctx?: number): Promise<void>;
  unload(model: string): Promise<void>;
  listLoaded(): Promise<string[]>;
  reachable(): Promise<boolean>;
};

/** Races a promise against `probeTimeoutMs()` so an unreachable LM Studio
 * daemon (the SDK connects over WebSocket and can hang rather than reject)
 * doesn't stall `detect()`. */
function withTimeout<T>(p: Promise<T>, onTimeout: T): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((resolve) =>
      setTimeout(() => resolve(onTimeout), probeTimeoutMs()),
    ),
  ]);
}

/** Default `LmStudioClient` backed by the real `@lmstudio/sdk`. Verified
 * against `@lmstudio/sdk@1.5.0`'s shipped types: `LMStudioClient` exposes an
 * `llm` namespace (`ModelNamespace<LLMLoadModelConfig, ...>`) with
 * `load(modelKey, { config: { contextLength } })`, `unload(identifier)`, and
 * `listLoaded(): Promise<LLM[]>` (each `LLM` has `.identifier`). There is no
 * dedicated ping/health call, so reachability is inferred from a
 * `system.getLMStudioVersion()` round-trip. */
function createDefaultLmStudioClient(): LmStudioClient {
  const client = new LMStudioClient();
  return {
    async load(model, ctx) {
      await client.llm.load(model, {
        config: ctx ? { contextLength: ctx } : undefined,
      });
    },
    async unload(model) {
      await client.llm.unload(model);
    },
    async listLoaded() {
      const loaded = await client.llm.listLoaded();
      return loaded.map((m) => m.identifier);
    },
    async reachable() {
      return withTimeout(
        client.system
          .getLMStudioVersion()
          .then(() => true)
          .catch(() => false),
        false,
      );
    },
  };
}

/** LM Studio inference runtime: an always-on daemon (no `launch`) whose
 * context window is set per-load (`contextCapability: 'reload'`). All
 * `@lmstudio/sdk` calls are isolated behind `getClient()` so this strategy
 * is testable with a fake client. */
export function makeLmStudioStrategy(
  getClient: () => LmStudioClient,
): RuntimeStrategy {
  return {
    kind: RuntimeKind.LmStudio,
    contextCapability: 'reload',
    defaultPort: 1234,
    healthPath: '/v1/models',
    basePath: '/v1',
    async detect(): Promise<boolean> {
      return getClient().reachable();
    },
    async daemonLoad(
      model: string,
      numCtx: number | undefined,
    ): Promise<{ baseUrl: string }> {
      await getClient().load(model, numCtx);
      return { baseUrl: 'http://127.0.0.1:1234/v1' };
    },
    async daemonUnload(model: string): Promise<void> {
      await getClient().unload(model);
    },
  };
}

let defaultClient: LmStudioClient | undefined;
/** Lazily constructs a single shared `LMStudioClient` (each instance opens
 * its own WebSocket connection, so this seam is memoized rather than
 * reconnecting on every call). */
function getDefaultClient(): LmStudioClient {
  defaultClient ??= createDefaultLmStudioClient();
  return defaultClient;
}

export const lmStudioStrategy: RuntimeStrategy =
  makeLmStudioStrategy(getDefaultClient);
export const lmStudioRuntime: Runtime = createManagedRuntime(lmStudioStrategy);
