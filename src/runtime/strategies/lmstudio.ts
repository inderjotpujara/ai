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

/** Default `LmStudioClient` backed by the real `@lmstudio/sdk`. Verified
 * against `@lmstudio/sdk@1.5.0`'s shipped types: `LMStudioClient` exposes an
 * `llm` namespace (`ModelNamespace<LLMLoadModelConfig, ...>`) with
 * `load(modelKey, { config: { contextLength } })`, `unload(identifier)`, and
 * `listLoaded(): Promise<LLM[]>` (each `LLM` has `.identifier`).
 *
 * `reachable()` deliberately does NOT touch `@lmstudio/sdk`: live-verified,
 * merely constructing `new LMStudioClient()` when no daemon is listening
 * eagerly opens a WebSocket and starts a background reconnect loop that
 * prints a boxed "Failed to connect to LM Studio" error (bypassing the
 * `logger` constructor option) on a repeating timer for the life of the
 * process — a bad default for a health probe most users without LM Studio
 * installed will hit on every `availableRuntimes()` scan. A plain REST
 * fetch against the OpenAI-compatible `/v1/models` endpoint gives the same
 * answer instantly and silently, so the SDK client is constructed lazily —
 * only by `load`/`unload`/`listLoaded`, i.e. once this runtime is actually
 * selected. */
function createDefaultLmStudioClient(): LmStudioClient {
  let sdkClient: LMStudioClient | undefined;
  const sdk = (): LMStudioClient => {
    sdkClient ??= new LMStudioClient();
    return sdkClient;
  };
  return {
    async load(model, ctx) {
      await sdk().llm.load(model, {
        config: ctx ? { contextLength: ctx } : undefined,
      });
    },
    async unload(model) {
      await sdk().llm.unload(model);
    },
    async listLoaded() {
      const loaded = await sdk().llm.listLoaded();
      return loaded.map((m) => m.identifier);
    },
    async reachable() {
      try {
        const res = await fetch('http://127.0.0.1:1234/v1/models', {
          signal: AbortSignal.timeout(probeTimeoutMs()),
        });
        return res.ok;
      } catch {
        return false;
      }
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
/** Memoizes the default `LmStudioClient` wrapper so its lazily-built inner
 * `LMStudioClient` (each instance opens its own WebSocket) is reused rather
 * than reconstructed on every `load`/`unload`/`listLoaded` call. */
function getDefaultClient(): LmStudioClient {
  defaultClient ??= createDefaultLmStudioClient();
  return defaultClient;
}

export const lmStudioStrategy: RuntimeStrategy =
  makeLmStudioStrategy(getDefaultClient);
export const lmStudioRuntime: Runtime = createManagedRuntime(lmStudioStrategy);
