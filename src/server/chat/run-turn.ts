import qwenRouter from '../../../models/qwen-router.ts';
import { runChatSession } from '../../cli/run-chat-session.ts';
import { createSelectHook } from '../../cli/select-hook.ts';
import { withMcpRun } from '../../cli/with-mcp-run.ts';
import type { StreamSink } from '../../core/agent.ts';
import type { EventSink } from '../../core/events.ts';
import type { OrchestratorResult } from '../../core/orchestrator.ts';
import type { ResourceCapture } from '../../core/resource-capture.ts';
import type { ModelDeclaration } from '../../core/types.ts';
import { buildRegistry } from '../../discovery/build-registry.ts';
import type { IngestFlags } from '../../media/ingest.ts';
import { createMediaStore } from '../../media/store.ts';
import type { MemoryStore } from '../../memory/store.ts';
import { createModelManager } from '../../resource/model-manager.ts';
import { listLoadedModels } from '../../resource/ollama-control.ts';
import { newRunId } from '../../run/run-id.ts';

/** One per-request chat-turn runner, invoked by `handleChat` for every
 *  `POST /api/chat` call. Real implementations compose `withMcpRun` + the
 *  engine (registry/manager/select-hook) + `runChatSession`; tests inject a
 *  fake so `handler.ts` is exercised without booting Ollama/MCP. */
export type RunChatTurn = (input: {
  task: string;
  /** Media-by-reference (Task 16): pre-resolved absolute paths under the
   *  confined uploads dir, built by `handleChat` from the request's
   *  `uploadIds`. `runChatSession` ingests these the same way the CLI's
   *  `--image` flag does. */
  media?: IngestFlags;
  events: EventSink;
  stream: StreamSink;
  signal?: AbortSignal;
}) => Promise<OrchestratorResult>;

/**
 * Lazy, memoized engine accessor bag. Nothing is built/warmed at server boot
 * (only on the FIRST chat request) so existing perimeter/health tests — and
 * the server itself — stay green without Ollama running. `manager()` and
 * `registry()` each memoize their one-time (possibly async) construction;
 * `routerNumCtx()` is intentionally left undefined here (documented choice,
 * see below) rather than eagerly warming the router model on first access.
 */
type ModelManager = ReturnType<typeof createModelManager>;

export type LazyEngine = {
  manager(): ModelManager;
  registry(): Promise<ModelDeclaration[]>;
  /**
   * The router model's context window, if already warmed. Warming
   * `qwenRouter` up front (to populate this) would mean the FIRST chat
   * request pays for an extra ensureReady round-trip before the real one
   * `createSelectHook`/`resolveModel` performs anyway (Ollama warms lazily
   * inside `resolveModel`). Left `undefined` here — `resolveModel` computes
   * its own numCtx per call — is the cheaper, equally-correct choice; a
   * managed (non-Ollama) runtime still gets its explicit warm inside
   * `createSelectHook` itself.
   */
  routerNumCtx(): number | undefined;
  runsRoot: string;
};

/** Build a `LazyEngine` rooted at `runsRoot` (e.g. `'runs'`). Nothing runs
 *  until the first `manager()`/`registry()` call from a real chat turn. */
export function createLazyEngine(runsRoot: string): LazyEngine {
  let manager: ModelManager | undefined;
  let registryPromise: Promise<ModelDeclaration[]> | undefined;
  return {
    manager(): ModelManager {
      manager ??= createModelManager();
      return manager;
    },
    registry(): Promise<ModelDeclaration[]> {
      registryPromise ??= buildRegistry();
      return registryPromise;
    },
    routerNumCtx(): number | undefined {
      return undefined;
    },
    runsRoot,
  };
}

/** Build the real, non-test `RunChatTurn`: one `withMcpRun` scope per HTTP
 *  request, mounting MCP + running the shared `runChatSession` engine path
 *  (the exact same path the CLI uses). Kept thin and correct — this seam is
 *  covered by live-verify, not unit tests (it composes real MCP mount +
 *  engine wiring, which unit tests would only mock away). */
export function createRealRunChatTurn(
  engine: LazyEngine,
  memoryStore?: MemoryStore,
): RunChatTurn {
  return async ({ task, media, events, stream, signal }) => {
    const registry = await engine.registry();
    return withMcpRun(
      { runsRoot: engine.runsRoot, runId: newRunId() },
      async ({ run, reg, ledger }) => {
        const capture: ResourceCapture = {};
        const selectHook = createSelectHook({
          registry,
          ensureReady: (d, o) => engine.manager().ensureReady(d, o),
          listLoaded: () => listLoadedModels(),
          pinned: [qwenRouter.model],
          capture,
          ledger,
        });
        const store = createMediaStore(run.dir);
        const { result } = await runChatSession({
          task,
          media,
          // D17: DISABLE the prompt-text filesystem auto-detect on the server
          // path. `media` (confined uploadId→path handoff) is the ONLY way the
          // browser attaches a file; the task text itself is attacker-
          // controlled over HTTP, so scanning it for real host paths + reading
          // them would be an arbitrary-file-read hole. `() => false` makes
          // `autoDetectPaths` a no-op without touching `flags.images`.
          ingestDeps: { exists: () => false },
          events,
          stream,
          signal,
          deps: {
            registry: reg,
            selectHook,
            capture,
            run,
            ledger,
            routerNumCtx: engine.routerNumCtx(),
            mediaStore: store,
            memoryStore,
          },
        });
        return result;
      },
    );
  };
}
