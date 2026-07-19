import { loadConfig } from '../config/schema.ts';
import { computeConcurrency } from '../queue/concurrency.ts';

/** Fixed-window rate limiter for run-dir creation (item 2). Injectable clock. */
export function makeRunRateLimiter(opts: {
  max: number;
  windowMs: number;
  now?: () => number;
}): { allow(): boolean } {
  const now = opts.now ?? Date.now;
  let windowStart = now();
  let count = 0;
  return {
    allow(): boolean {
      const t = now();
      if (t - windowStart >= opts.windowMs) {
        windowStart = t;
        count = 0;
      }
      if (count >= opts.max) return false;
      count++;
      return true;
    },
  };
}

/** Max run-dir creations per fixed window. Computed from worker concurrency
 *  (never a hardcoded N) when AGENT_WEB_RUN_RATE is 0/unset; a positive env
 *  value overrides. Mirrors `maxStreams()` (server/runs/stream-limit.ts). */
export function maxRunsPerWindow(): number {
  const configured = loadConfig().values.AGENT_WEB_RUN_RATE as number;
  if (Number.isInteger(configured) && configured > 0) return configured;
  return computeConcurrency() * 10;
}

/** Fixed window for the run-dir creation rate cap. */
export const RUN_RATE_WINDOW_MS = 60_000;

/** Process-shared limiter every run-launch route (jobs/crews/workflows/pull)
 *  gates `createRun` behind, so a client (local or remote) can't spam run-dir
 *  creation. ONE instance per process — built once at server boot
 *  (`server/main.ts`) and threaded through `ServerDeps.runLimiter` so all four
 *  routes share the same window/count (a client can't reset the cap by hitting
 *  a different route). Each handler's own `Deps.runLimiter` is optional and
 *  defaults to {@link ALWAYS_ALLOW} — NOT this singleton — so a unit test that
 *  constructs a handler's deps directly (most do, without ServerDeps/app.ts in
 *  the loop) never accidentally shares mutable rate-limit state with unrelated
 *  tests in the same process. */
export function createProcessRunLimiter(): { allow(): boolean } {
  return makeRunRateLimiter({
    max: maxRunsPerWindow(),
    windowMs: RUN_RATE_WINDOW_MS,
  });
}

/** Permissive fallback for a handler's optional `runLimiter` dep when the
 *  caller (a unit test, or a fixture that predates this knob) doesn't supply
 *  one — preserves pre-existing behavior (no cap) rather than silently
 *  sharing global rate-limit state across unrelated call sites. */
export const ALWAYS_ALLOW: { allow(): boolean } = { allow: () => true };
