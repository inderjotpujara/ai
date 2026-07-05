/** Reliability knobs. Computed defaults; env vars are fallback-only overrides. */

function envNumber(name: string, fallback: number): number {
  return Number(process.env[name]) || fallback;
}

/** Max attempts for a cross-boundary op we own (retry.ts). Not for LLM turns. */
export function maxAttempts(): number {
  return envNumber('AGENT_MAX_ATTEMPTS', 4);
}
/** Hard wall-clock cap for a single agent turn / step attempt. */
export function runTimeoutMs(): number {
  return envNumber('AGENT_RUN_TIMEOUT_MS', 120_000);
}
/** Idle cap for a progress-bearing op — resets on observed progress. */
export function idleTimeoutMs(): number {
  return envNumber('AGENT_IDLE_TIMEOUT_MS', 90_000);
}
/** Consecutive failures before a breaker opens. */
export function breakerThreshold(): number {
  return envNumber('AGENT_BREAKER_THRESHOLD', 5);
}
/** How long a breaker stays open before allowing a half-open probe. */
export function breakerCooldownMs(): number {
  return envNumber('AGENT_BREAKER_COOLDOWN_MS', 60_000);
}
/** Successful half-open probes required to close a breaker. */
export function breakerHalfOpenProbes(): number {
  return envNumber('AGENT_BREAKER_HALF_OPEN_PROBES', 1);
}
/** Base backoff for retry.ts. */
export function retryBaseMs(): number {
  return envNumber('AGENT_RETRY_BASE_MS', 1_000);
}
/** Backoff cap for retry.ts. */
export function retryCapMs(): number {
  return envNumber('AGENT_RETRY_CAP_MS', 45_000);
}
/** Liveness-probe timeout (runtime isAvailable / listModels). */
export function probeTimeoutMs(): number {
  return envNumber('AGENT_PROBE_TIMEOUT_MS', 1_500);
}
