import { AsyncLocalStorage } from 'node:async_hooks';

/** The running agent's context budget rides the same context as depth/ancestry. */
export type DelegationContext = {
  depth: number;
  ancestors: string[];
  numCtx?: number;
};

const storage = new AsyncLocalStorage<DelegationContext>();
const ROOT: DelegationContext = { depth: 0, ancestors: [] };

/** ~chars per token (English approximation). A unit conversion, not a tunable budget. */
const CHARS_PER_TOKEN = 4;
/** Conservative context floor when a caller's num_ctx is unknown (mirrors Model Manager MIN_CTX). */
const FALLBACK_CTX = 4096;

export function currentDelegationContext(): DelegationContext {
  return storage.getStore() ?? ROOT;
}

/** Max delegation depth. Env AGENT_MAX_DELEGATION_DEPTH (fallback-only), default 5. */
export function maxDelegationDepth(): number {
  const raw = Number(process.env.AGENT_MAX_DELEGATION_DEPTH);
  return Number.isInteger(raw) && raw > 0 ? raw : 5;
}

/** Fraction of the caller's context a single return may occupy. Env AGENT_RETURN_CTX_FRACTION, default 0.25. */
export function returnCtxFraction(): number {
  const raw = Number(process.env.AGENT_RETURN_CTX_FRACTION);
  return raw > 0 && raw <= 1 ? raw : 0.25;
}

/** LIVE char cap for a return consumed by an agent with `callerNumCtx` tokens of context. */
export function returnCapChars(callerNumCtx: number | undefined): number {
  const ctx = callerNumCtx && callerNumCtx > 0 ? callerNumCtx : FALLBACK_CTX;
  return Math.floor(returnCtxFraction() * ctx * CHARS_PER_TOKEN);
}

export type DelegationCheck =
  | { ok: true }
  | { ok: false; kind: 'depth_exceeded'; reason: string };

/** Depth-only: recursion (a repeated agent name) is permitted; depth bounds it. */
export function checkDelegation(target: string): DelegationCheck {
  const { depth, ancestors } = currentDelegationContext();
  if (depth + 1 > maxDelegationDepth()) {
    return {
      ok: false,
      kind: 'depth_exceeded',
      reason: `Delegation depth limit (${maxDelegationDepth()}) exceeded at '${target}' (chain: ${[...ancestors, target].join(' → ')}).`,
    };
  }
  return { ok: true };
}

/** Run `fn` inside the context for entering `target`, recording the budget `numCtx` that target runs with. */
export function runInDelegationContext<T>(
  target: string,
  numCtx: number | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  const { depth, ancestors } = currentDelegationContext();
  return storage.run(
    { depth: depth + 1, ancestors: [...ancestors, target], numCtx },
    fn,
  );
}

/** Seed the root context with the top agent's (orchestrator's) context budget. */
export function withRootDelegationContext<T>(
  numCtx: number | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  return storage.run({ depth: 0, ancestors: [], numCtx }, fn);
}

/** Cap a return to returnCapChars(callerNumCtx) with a clear truncation marker. */
export function concise(
  text: string,
  callerNumCtx: number | undefined,
): string {
  const cap = returnCapChars(callerNumCtx);
  if (text.length <= cap) return text;
  return `${text.slice(0, cap)}\n…[truncated, ${text.length - cap} chars omitted]`;
}
