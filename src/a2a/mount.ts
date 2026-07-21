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
 *  - **NO second delegation span here.** `withDelegationSpan` (→ `agent.delegation`)
 *    already fires when the orchestrator invokes this tool through
 *    `runGuardedAgent`; the A2A hop is the tool's `execute`, which nests under
 *    it. The client's own `a2a.client.invoke` span (Task 20) is the A2A-layer
 *    span — this module emits none.
 *
 * The breaker is keyed per-remote (`a2a:<name>`) so one dead peer fast-fails on
 * its own circuit without dragging down the others.
 */

import { randomUUID } from 'node:crypto';
import { type ToolSet, tool } from 'ai';
import { z } from 'zod';
import {
  type A2aArtifact,
  A2aMethod,
  TaskSchema,
  TaskStateWire,
} from '../contracts/index.ts';
import { wrapToolsWithBreaker } from '../mcp/client.ts';
import type { createA2aClient, RemoteAgent } from './client.ts';

type A2aClient = ReturnType<typeof createA2aClient>;

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

/**
 * Extract the completed-artifact text from a remote `message/send` result, or
 * THROW so the breaker counts the failure. A throw here is intentional: it is
 * caught by the outer wrapper (below) and converted to a structured `{ error }`,
 * exactly as `runGuardedAgent`'s try/catch does for a local specialist — the
 * throw is what lets a persistently-dead peer trip its circuit.
 */
function completedArtifactText(result: unknown): string {
  const parsed = TaskSchema.safeParse(result);
  if (!parsed.success) {
    throw new Error('remote returned a malformed task');
  }
  const task = parsed.data;
  const state = task.status.state;
  if (state !== TaskStateWire.Completed) {
    // A Failed/Rejected/Canceled peer task is a remote failure — surface it AND
    // let it count toward the breaker (Working/Submitted here means the peer
    // answered without a terminal artifact, which we likewise cannot use).
    const detail = task.status.message
      ? artifactsText([{ artifactId: '', parts: task.status.message.parts }])
      : '';
    throw new Error(
      `remote task did not complete (state=${state})${detail ? `: ${detail}` : ''}`,
    );
  }
  const text = artifactsText(task.artifacts);
  if (text.length === 0) {
    throw new Error('remote task completed with no text artifact');
  }
  return text;
}

/**
 * Mount ONE remote peer as a `delegate_to_<name>` `ToolSet`. The tool's
 * `inputSchema` is `{ task: z.string() }` — identical to `asDelegateTool` — and
 * its `execute` sends the task as a `message/send` and returns the completed
 * artifact text. Layering (why three levels):
 *   1. the RAW execute throws on any remote failure (rejected invoke / malformed
 *      / non-completed / empty) so the breaker can observe it;
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
): ToolSet {
  const name = delegateRemoteToolName(remote);

  // (1) Raw tool — throws on failure so the breaker (2) can count it.
  const raw: ToolSet = {
    [name]: tool({
      description: `Delegate a task to the remote agent "${remote.name}" over A2A.`,
      inputSchema: z.object({
        task: z.string().describe('The task for the remote agent'),
      }),
      execute: async ({ task }: { task: string }) => {
        const message = {
          role: 'user' as const,
          parts: [{ kind: 'text' as const, text: task }],
          messageId: randomUUID(),
        };
        const result = await client.invoke(remote, A2aMethod.MessageSend, {
          message,
        });
        return completedArtifactText(result);
      },
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
): ToolSet {
  const merged: ToolSet = {};
  for (const remote of remotes) {
    for (const [toolName, t] of Object.entries(
      remoteAsToolSet(remote, client),
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
