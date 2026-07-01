/** ~chars per token (English approximation). A unit conversion, not a tunable. */
const CHARS_PER_TOKEN = 4;
/** Context floor when a caller's num_ctx is unknown (mirrors guardrails FALLBACK_CTX). */
const FALLBACK_CTX = 4096;

/** Fraction of the caller's context that retrieved memory may occupy.
 *  Env AGENT_MEMORY_CTX_FRACTION (fallback-only), default 0.25. */
export function retrievalCtxFraction(): number {
  const raw = Number(process.env.AGENT_MEMORY_CTX_FRACTION);
  return raw > 0 && raw <= 1 ? raw : 0.25;
}

/** LIVE char budget for memory injected into an agent with `callerNumCtx` tokens. */
export function retrievalBudgetChars(callerNumCtx: number | undefined): number {
  const ctx = callerNumCtx && callerNumCtx > 0 ? callerNumCtx : FALLBACK_CTX;
  return Math.floor(retrievalCtxFraction() * ctx * CHARS_PER_TOKEN);
}
