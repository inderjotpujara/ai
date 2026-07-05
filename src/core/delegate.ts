import type { LanguageModel } from 'ai';
import { tool } from 'ai';
import { z } from 'zod';
import { classify } from '../reliability/classify.ts';
import { CircuitOpenError } from '../reliability/errors.ts';
import { type DegradationLedger, DegradeKind } from '../reliability/ledger.ts';
import {
  recordDegrade,
  recordGuardrailViolation,
  withDelegationSpan,
} from '../telemetry/spans.ts';
import { type Agent, runDefinedAgent } from './agent-def.ts';
import {
  checkDelegation,
  concise,
  currentDelegationContext,
  runInDelegationContext,
} from './guardrails.ts';

/** The orchestrator-facing tool name for delegating to an agent. */
export function delegateToolName(agent: Agent): string {
  return `delegate_to_${agent.name}`;
}

/**
 * A hook run just before a delegated agent executes. May return a chosen context
 * size, a model to bind for this call, and/or an `abort` message that skips the
 * delegation entirely (returned to the orchestrator as a soft tool error).
 */
export type BeforeDelegate = (
  agent: Agent,
  // biome-ignore lint/suspicious/noConfusingVoidType: void is intentional — hooks may return nothing.
) => Promise<{ numCtx?: number; model?: LanguageModel; abort?: string } | void>;

/** Run an agent through the full Slice-9 guarded delegation path:
 *  delegation span · depth guard · before-delegate hook · context wrap · return cap.
 *  Shared by the orchestrator's delegate tool and the workflow engine's agent
 *  step. `abortSignal` (optional) is threaded down to the underlying
 *  generateText so a caller can wall-clock-bound the run (verify gate). */
export function runGuardedAgent(
  agent: Agent,
  task: string,
  onBeforeDelegate?: BeforeDelegate,
  abortSignal?: AbortSignal,
  ledger?: DegradationLedger,
): Promise<{ text: string } | { error: string }> {
  return withDelegationSpan(agent.name, async () => {
    const check = checkDelegation(agent.name);
    if (!check.ok) {
      recordGuardrailViolation(check.kind, check.reason);
      return { error: check.reason };
    }
    const callerNumCtx = currentDelegationContext().numCtx;
    try {
      const pre = onBeforeDelegate ? await onBeforeDelegate(agent) : undefined;
      if (pre?.abort) {
        return { error: pre.abort };
      }
      const { text } = await runInDelegationContext(
        agent.name,
        pre?.numCtx,
        () =>
          runDefinedAgent(agent, task, pre?.numCtx, pre?.model, abortSignal),
      );
      return { text: concise(text, callerNumCtx) };
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      const kind =
        cause instanceof CircuitOpenError
          ? DegradeKind.CircuitOpen
          : DegradeKind.AgentDropped;
      const lane = classify(cause);
      const event = {
        kind,
        subject: agent.name,
        reason: message,
        detail: `lane=${lane}`,
      };
      ledger?.record(event);
      recordDegrade(event);
      return { error: `Agent ${agent.name} failed: ${message}` };
    }
  });
}

/**
 * Wrap an agent as a tool the orchestrator can call. On failure it RETURNS a
 * structured error (so the orchestrator model can react) rather than throwing.
 */
export function asDelegateTool(
  agent: Agent,
  onBeforeDelegate?: BeforeDelegate,
  ledger?: DegradationLedger,
) {
  return tool({
    description: agent.description,
    inputSchema: z.object({
      task: z.string().describe('The task for this agent'),
    }),
    execute: async ({ task }, options) =>
      runGuardedAgent(
        agent,
        task,
        onBeforeDelegate,
        options?.abortSignal,
        ledger,
      ),
  });
}
