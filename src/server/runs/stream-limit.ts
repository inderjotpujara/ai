import { loadConfig } from '../../config/schema.ts';
import { computeConcurrency } from '../../queue/concurrency.ts';

let open = 0;

/** Cap on simultaneously-open run SSE streams. Computed from worker concurrency
 *  when AGENT_WEB_MAX_STREAMS is 0/unset (never a hardcoded N); a positive env
 *  value overrides. Each run may have a few tailing clients, hence the headroom. */
export function maxStreams(): number {
  const configured = loadConfig().values.AGENT_WEB_MAX_STREAMS as number;
  if (Number.isInteger(configured) && configured > 0) return configured;
  return computeConcurrency() * 8;
}

export function acquireStreamSlot(cap = maxStreams()): boolean {
  if (open >= cap) return false;
  open++;
  return true;
}

export function releaseStreamSlot(): void {
  open = Math.max(0, open - 1);
}

export function openStreamCount(): number {
  return open;
}
