import { availableParallelism, totalmem } from 'node:os';

/**
 * Worker-pool concurrency: how many jobs run at once. Computed from hardware —
 * NEVER hardcoded (repo rule). Each job may drive a local model, so we take a
 * conservative fraction of logical cores (half, floored at 1) and never exceed
 * the core count. `AGENT_QUEUE_CONCURRENCY` overrides when a positive integer.
 */
export function computeConcurrency(
  deps: {
    parallelism?: () => number;
    totalmemBytes?: () => number;
    env?: string;
  } = {},
): number {
  const raw = deps.env ?? process.env.AGENT_QUEUE_CONCURRENCY;
  const override = Number(raw);
  if (Number.isInteger(override) && override > 0) return override;
  const cores = (deps.parallelism ?? availableParallelism)();
  void (deps.totalmemBytes ?? totalmem); // reserved for a future RAM-aware cap
  return Math.max(1, Math.floor(cores / 2));
}
