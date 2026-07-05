import { APICallError } from 'ai';
import { ProviderError, ResourceError, ToolError } from '../core/errors.ts';

/** Three lanes drive the retry/degrade/partial-failure wiring. */
export enum Lane {
  Transient = 'Transient', // back off + retry (ops we own only)
  RouteWorthy = 'RouteWorthy', // don't backoff — degrade/fallback/skip
  Terminal = 'Terminal', // fail fast — no retry, surface to user
}

const TRANSIENT_CODES = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'ECONNREFUSED',
  'EPIPE',
]);

/**
 * Classify an error into a reliability lane. Pure; never throws.
 * Unknown/unclassifiable → Terminal (fail safe: never silently retry the unknown).
 */
export function classify(err: unknown): Lane {
  if (APICallError.isInstance(err)) {
    return err.isRetryable ? Lane.Transient : Lane.Terminal;
  }
  if (err instanceof ProviderError || err instanceof ResourceError) {
    return Lane.RouteWorthy;
  }
  if (err instanceof ToolError) {
    return Lane.Terminal;
  }
  const code = (err as { code?: unknown })?.code;
  if (typeof code === 'string' && TRANSIENT_CODES.has(code)) {
    return Lane.Transient;
  }
  return Lane.Terminal;
}
