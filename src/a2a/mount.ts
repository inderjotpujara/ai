/**
 * A2A CONSUME-side mount (Slice 31, Task 21) — turn a discovered + pinned
 * remote peer (`RemoteAgent`, Task 20) into a `delegate_to_<name>` tool that is
 * INDISTINGUISHABLE from a local specialist to the orchestrator. It reuses the
 * MCP mount seam: the produced `ToolSet` flows through `MountedRegistry.forAgent`
 * → `createSuperAgent` `toolsFor` unchanged, so the mounted remote inherits the
 * orchestrator's guardrails, depth-guard, per-dependency breaker, and the
 * `agent.delegation` span FOR FREE.
 *
 * Two invariants make it a drop-in peer:
 *  - **Failure RETURNS, never throws** — exactly the `asDelegateTool`
 *    (`src/core/delegate.ts`) contract. A rejected `invoke`, a malformed/failed
 *    remote task, or a tripped breaker (`CircuitOpenError`) all collapse to a
 *    structured `{ error }` result the orchestrator model handles like any
 *    specialist gap — never an unhandled throw that crashes the run.
 *  - **NO `agent.delegation` span for the remote hop.** As of Task 29b the
 *    live path (`liveRemoteDelegateTools`) inserts these tools DIRECTLY into
 *    `createOrchestrator`'s toolset — they execute as a plain AI-SDK tool call,
 *    NOT through `runGuardedAgent`, so `withDelegationSpan` never wraps a remote
 *    delegate and NO `agent.delegation` span fires for it (unlike a local
 *    specialist). This is intentional: the client's own `a2a.client.invoke`
 *    span (Task 20) is the sole A2A-layer span for the hop, and this module
 *    emits none of its own. (The earlier Task-21 header claimed the hop nests
 *    under an orchestrator `agent.delegation` span; that was true only under the
 *    since-superseded scoped-under-a-specialist design and is false now.)
 *
 * The breaker is keyed per-remote (`a2a:<name>`) so one dead peer fast-fails on
 * its own circuit without dragging down the others.
 */

import { randomUUID } from 'node:crypto';
import { type ToolSet, tool } from 'ai';
import { z } from 'zod';
import { loadConfig } from '../config/schema.ts';
import {
  type A2aArtifact,
  A2aMethod,
  type A2aTask,
  TaskSchema,
  TaskStateWire,
} from '../contracts/index.ts';
import { wrapToolsWithBreaker } from '../mcp/client.ts';
import { createA2aClient, type RemoteAgent } from './client.ts';
import { createRemoteStore, type RemoteStore } from './remotes.ts';

type A2aClient = ReturnType<typeof createA2aClient>;

/**
 * Tunables for the send→poll-to-terminal delegation loop. Both default to the
 * `AGENT_A2A_TASK_TIMEOUT_MS` / `AGENT_A2A_POLL_INTERVAL_MS` config knobs
 * (env-fallback only, never hardcoded at a call site); `sleep` is injectable so
 * a test can drive the loop with tiny values / fake timers without hanging the
 * suite.
 */
export type MountDeps = {
  taskTimeoutMs?: number;
  pollIntervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
};

/** Non-terminal states the peer's task can sit in — the loop KEEPS polling
 *  while the task is one of these, and stops (returns/errors) on anything else.
 *  This is the "still working vs terminal" distinction: we never conflate a
 *  merely-in-progress task with a failure. */
const POLLING_STATES = new Set<TaskStateWire>([
  TaskStateWire.Submitted,
  TaskStateWire.Working,
]);

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** The orchestrator-facing tool name for delegating to a remote peer — mirrors
 *  `delegateToolName` (`src/core/delegate.ts`) so a remote reads identically to
 *  a local specialist in the routing catalog. */
export function delegateRemoteToolName(remote: RemoteAgent): string {
  return `delegate_to_${remote.name}`;
}

/** Join every TEXT part of a completed task's artifacts. File/data parts carry
 *  no delegable text, so they are skipped (mirrors the produce-side
 *  `orchestratorResultToArtifact`, which only ever emits a text part). */
function artifactsText(artifacts: readonly A2aArtifact[]): string {
  return artifacts
    .flatMap((a) => a.parts)
    .filter((p): p is { kind: 'text'; text: string } => p.kind === 'text')
    .map((p) => p.text)
    .join('\n');
}

/** Parse a raw JSON-RPC result into a validated task, or THROW so the breaker
 *  counts a malformed peer response. */
function parseTask(result: unknown): A2aTask {
  const parsed = TaskSchema.safeParse(result);
  if (!parsed.success) {
    throw new Error('remote returned a malformed task');
  }
  return parsed.data;
}

/** Human-readable detail from a terminal-but-not-completed task's status
 *  message. Handles both a text part and the produce-side data-error part
 *  (`{ kind: 'data', data: { error } }`, e.g. a consent-declined run). */
function terminalDetail(task: A2aTask): string {
  const message = task.status.message;
  if (message === undefined) return '';
  const pieces = message.parts.map((part) => {
    if (part.kind === 'text') return part.text;
    if (part.kind === 'data') {
      const err = part.data.error;
      if (err === undefined) return '';
      return typeof err === 'string' ? err : JSON.stringify(err);
    }
    return '';
  });
  return pieces.filter((piece) => piece.length > 0).join('\n');
}

/** Extract the completed-artifact text, or THROW if a Completed task carries no
 *  text artifact (a completed-but-empty peer answer is unusable). */
function completedText(task: A2aTask): string {
  const text = artifactsText(task.artifacts);
  if (text.length === 0) {
    throw new Error('remote task completed with no text artifact');
  }
  return text;
}

/**
 * The send→poll-to-terminal delegation. `message/send` returns a `submitted`
 * task (the peer just ENQUEUED the job — see `handleMessageSend`), whose answer
 * is only reachable by polling `tasks/get` until the task reaches a terminal
 * state. This loop does exactly that, bounded by an overall wall-clock budget:
 *  - `completed` → return the artifact text (`completedText`);
 *  - `failed`/`rejected`/`canceled` (or any other non-polling terminal, e.g.
 *    `input-required`/`auth-required` we cannot satisfy) → THROW the task's
 *    detail so it surfaces as a structured error AND counts toward the breaker;
 *  - budget exhausted while still `submitted`/`working` → THROW
 *    `remote task timed out` (never hangs).
 * Every throw is intentional: the outer wrapper converts it to `{ error }`, so
 * the tool NEVER throws — matching the `asDelegateTool` contract — while a
 * persistently-dead/slow peer still trips its per-remote circuit.
 *
 * Exported (not just used internally by `remoteAsToolSet`) so `agent a2a call`
 * (`src/cli/a2a.ts`, Task 27) can drive the SAME send→poll loop the mounted
 * orchestrator tool uses, instead of re-implementing it — here it is left to
 * throw (the CLI's own dispatch converts the throw to a printed error).
 */
export async function delegateAndPoll(
  remote: RemoteAgent,
  client: A2aClient,
  task: string,
  cfg: {
    taskTimeoutMs: number;
    pollIntervalMs: number;
    sleep: (ms: number) => Promise<void>;
  },
): Promise<string> {
  const message = {
    role: 'user' as const,
    parts: [{ kind: 'text' as const, text: task }],
    messageId: randomUUID(),
  };
  const sent = parseTask(
    await client.invoke(remote, A2aMethod.MessageSend, { message }),
  );

  const deadline = Date.now() + cfg.taskTimeoutMs;
  let current = sent;
  for (;;) {
    const state = current.status.state;
    if (state === TaskStateWire.Completed) {
      return completedText(current);
    }
    if (!POLLING_STATES.has(state)) {
      // Terminal but not completed — a remote failure. Surface + count it.
      const detail = terminalDetail(current);
      throw new Error(
        `remote task did not complete (state=${state})${detail ? `: ${detail}` : ''}`,
      );
    }
    // Still submitted/working — poll again if the budget allows.
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new Error('remote task timed out');
    }
    await cfg.sleep(Math.min(cfg.pollIntervalMs, remaining));
    current = parseTask(
      await client.invoke(remote, A2aMethod.TasksGet, { id: sent.id }),
    );
  }
}

/**
 * Mount ONE remote peer as a `delegate_to_<name>` `ToolSet`. The tool's
 * `inputSchema` is `{ task: z.string() }` — identical to `asDelegateTool` — and
 * its `execute` sends the task as a `message/send`, then POLLS `tasks/get` to a
 * terminal state (`delegateAndPoll`) and returns the completed artifact text —
 * because `message/send` only returns a `submitted` shell, never the answer.
 * Layering (why three levels):
 *   1. the RAW execute throws on any remote failure (rejected invoke / malformed
 *      / terminal-not-completed / empty / timed out) so the breaker can observe it;
 *   2. `wrapToolsWithBreaker('a2a:<name>', …)` counts those throws and, once the
 *      circuit is open, fast-fails with `CircuitOpenError` WITHOUT calling the
 *      peer;
 *   3. the OUTER wrapper catches every throw (a peer error AND `CircuitOpenError`)
 *      and returns a structured `{ error }` — so the tool NEVER throws, matching
 *      the local delegate contract.
 */
export function remoteAsToolSet(
  remote: RemoteAgent,
  client: A2aClient,
  deps?: MountDeps,
): ToolSet {
  const name = delegateRemoteToolName(remote);
  const values = loadConfig().values;
  const cfg = {
    taskTimeoutMs:
      deps?.taskTimeoutMs ?? Number(values.AGENT_A2A_TASK_TIMEOUT_MS),
    pollIntervalMs:
      deps?.pollIntervalMs ?? Number(values.AGENT_A2A_POLL_INTERVAL_MS),
    sleep: deps?.sleep ?? defaultSleep,
  };

  // (1) Raw tool — sends then polls tasks/get to a terminal state, throwing on
  //     any failure (rejected invoke / malformed / terminal-not-completed /
  //     timeout) so the breaker (2) can count it.
  const raw: ToolSet = {
    [name]: tool({
      description: `Delegate a task to the remote agent "${remote.name}" over A2A.`,
      inputSchema: z.object({
        task: z.string().describe('The task for the remote agent'),
      }),
      execute: ({ task }: { task: string }) =>
        delegateAndPoll(remote, client, task, cfg),
    }),
  };

  // (2) Per-remote circuit breaker (`a2a:<name>`): a dead peer fast-fails on its
  //     own circuit and never affects the others.
  const guarded = wrapToolsWithBreaker(`a2a:${remote.name}`, raw);

  // (3) Failure-returns-not-throws — the `asDelegateTool` contract.
  const out: ToolSet = {};
  for (const [toolName, t] of Object.entries(guarded)) {
    const execute = t.execute;
    out[toolName] = execute
      ? ({
          ...t,
          execute: async (args: unknown, options: unknown) => {
            try {
              const text = (await execute(args, options as never)) as string;
              return { text };
            } catch (cause) {
              const detail =
                cause instanceof Error ? cause.message : String(cause);
              return { error: `Remote ${remote.name} failed: ${detail}` };
            }
          },
        } as typeof t)
      : t;
  }
  return out;
}

/**
 * Merge several remotes into one `ToolSet` (the `mountAll` idiom): a later
 * remote whose `delegate_to_<name>` collides with an earlier one warns and
 * overrides (a name clash means two peers share a `name` — an operator
 * config issue worth surfacing, not a crash).
 */
export function mountRemotes(
  remotes: RemoteAgent[],
  client: A2aClient,
  warn: (msg: string) => void = (m) => console.warn(m),
  deps?: MountDeps,
): ToolSet {
  const merged: ToolSet = {};
  for (const remote of remotes) {
    for (const [toolName, t] of Object.entries(
      remoteAsToolSet(remote, client, deps),
    )) {
      if (merged[toolName]) {
        warn(
          `remote "${remote.name}" tool "${toolName}" overrides an earlier remote's tool of the same name`,
        );
      }
      merged[toolName] = t;
    }
  }
  return merged;
}

/**
 * Build the `delegate_to_<name>` ToolSet for EVERY currently-configured remote
 * — the one seam a LIVE chat/crew/workflow turn calls to surface remotes as
 * orchestrator delegates (Slice 31, Task 29b). Gating + freshness invariants:
 *  - **Flag-gated.** `AGENT_A2A_ENABLED !== true` ⇒ `{}` immediately (a single
 *    memoized config read, no store I/O) so a turn with A2A off is byte-for-byte
 *    unchanged.
 *  - **No remotes ⇒ `{}`.** An empty store adds no tools and no latency.
 *  - **NO network at build.** `mountRemotes` only constructs tools; a peer is
 *    contacted solely when the orchestrator later invokes the delegate
 *    (`delegateAndPoll`) — reused as-is, never re-implemented, so the Task-21
 *    failure-returns-not-throws + per-remote breaker + single-`agent.delegation`-
 *    span properties carry over unchanged.
 *  - **Fresh per call.** The store is read anew each turn, so a remote added via
 *    the Federation console / `agent a2a remotes add` between turns is picked up
 *    without a restart (the console persists atomically; this re-reads the file).
 *
 * `remotes`/`client` are injectable for tests and for a caller that already
 * holds the shared expose-side instances; both default to freshly-constructed
 * ones bound to the standard config paths.
 */
export function liveRemoteDelegateTools(opts?: {
  remotes?: RemoteStore;
  client?: A2aClient;
  warn?: (msg: string) => void;
  deps?: MountDeps;
}): ToolSet {
  if (loadConfig().values.AGENT_A2A_ENABLED !== true) return {};
  const list = (opts?.remotes ?? createRemoteStore({})).list();
  if (list.length === 0) return {};
  const client = opts?.client ?? createA2aClient();
  return mountRemotes(list, client, opts?.warn, opts?.deps);
}
