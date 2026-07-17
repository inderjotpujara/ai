import { createSuperAgent } from '../../agents/super.ts';
import { StatusEventType } from '../contracts/index.ts';
import type { StreamSink } from '../core/agent.ts';
import type { BeforeDelegate } from '../core/delegate.ts';
import { type EventSink, noopEventSink } from '../core/events.ts';
import type { OrchestratorResult } from '../core/orchestrator.ts';
import type { ResourceCapture } from '../core/resource-capture.ts';
import type { MountedRegistry } from '../mcp/mount.ts';
import {
  type IngestDeps,
  type IngestFlags,
  ingestMedia,
} from '../media/ingest.ts';
import type { MediaStore } from '../media/store.ts';
import { injectRecall } from '../memory/recall-tool.ts';
import type { MemoryStore } from '../memory/store.ts';
import type { DegradationLedger } from '../reliability/ledger.ts';
import type { RunHandle } from '../run/run-store.ts';
import { type ChatDeps, runChat } from './run-chat.ts';

/** The dedicated memory space every chat turn recalls from and auto-ingests
 *  into (Slice 30b Phase 6, D5/D6). The single source of truth — `handler.ts`
 *  (T30) imports this SAME constant for its `rememberOnce` auto-ingest call
 *  so the two can never drift apart. */
export const CHAT_MEMORY_SPACE = 'chat';

export type ChatSessionDeps = {
  registry: MountedRegistry; // the MCP-scoped reg (has forAgent(name): ToolSet)
  selectHook: BeforeDelegate; // pre-built onBeforeDelegate (built by the caller)
  capture: ResourceCapture;
  run: RunHandle;
  ledger?: DegradationLedger;
  routerNumCtx?: number;
  mediaStore: MediaStore;
  /** Test seam — defaults to the real runChat. Mirrors runDefinedAgent's runAgentImpl. */
  runChatImpl?: (deps: ChatDeps) => Promise<OrchestratorResult>;
  /** Optional (Slice 30b Phase 6, D5): when present, `runChatSession` prepends
   *  recalled context from the shared `chat` memory space before running the
   *  orchestrator. CLI (`src/cli/chat.ts`, T31) wires it for the READ benefit
   *  only; the server (`src/server/chat/run-turn.ts`, T30) wires it for both
   *  read (here) and write (`handleChat`'s `rememberOnce` auto-ingest). */
  memoryStore?: MemoryStore;
};

export type ChatSessionInput = {
  task: string; // raw prompt (post-voice for CLI; from-messages for server)
  media?: IngestFlags; // when set, ingest media/markers via mediaStore
  /**
   * Passed to `ingestMedia` as its 4th arg. The SERVER path sets
   * `{ exists: () => false }` to disable the prompt-text filesystem
   * auto-detect (D17 — over HTTP the task text is attacker-controlled). The
   * CLI leaves it undefined so auto-detect stays on for the trusted local
   * caller (dragged-in paths in the terminal prompt still resolve).
   */
  ingestDeps?: IngestDeps;
  events?: EventSink;
  stream?: StreamSink;
  signal?: AbortSignal;
  deps: ChatSessionDeps;
};

export type ChatSessionResult = {
  result: OrchestratorResult;
  warnings: string[];
  /** The FINAL task actually run — post media-ingestion (markers spliced in,
   *  transcripts appended). The CLI's gap-branch epilogue seeds the reuse-hint
   *  and crew/agent builders from this exact string, matching pre-refactor. */
  task: string;
};

/** Run one chat turn headlessly: emit RunStart, ingest media, build+run the
 *  streaming orchestrator, emit RunEnd. NO console.* — the caller surfaces
 *  warnings (CLI prints; server streams). CLI/server share this exact path. */
export async function runChatSession(
  input: ChatSessionInput,
): Promise<ChatSessionResult> {
  const { deps } = input;
  const events = input.events ?? noopEventSink;
  const runChatImpl = deps.runChatImpl ?? runChat;
  events({
    type: StatusEventType.RunStart,
    runId: deps.run.id,
    task: input.task,
  });
  let task = input.task;
  const warnings: string[] = [];
  if (input.media) {
    const ingested = await ingestMedia(
      task,
      input.media,
      deps.mediaStore,
      input.ingestDeps,
    );
    task = ingested.prompt;
    warnings.push(...ingested.warnings);
  }
  if (deps.memoryStore) {
    task = await injectRecall(
      deps.memoryStore,
      { space: CHAT_MEMORY_SPACE },
      task,
    );
  }
  const orchestrator = createSuperAgent(
    (name) => deps.registry.forAgent(name),
    deps.selectHook,
    deps.ledger,
    deps.mediaStore,
    events,
  );
  const result = await runChatImpl({
    orchestrator,
    task,
    run: deps.run,
    routerNumCtx: deps.routerNumCtx,
    capture: deps.capture,
    signal: input.signal,
    stream: input.stream,
  });
  events({
    type: StatusEventType.RunEnd,
    runId: deps.run.id,
    outcome: result.kind,
  });
  return { result, warnings, task };
}
