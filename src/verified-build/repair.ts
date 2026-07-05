import { maxRepairs } from './config.ts';
import type { DryRunResult } from './types.ts';

/** Retry a failing attempt up to maxRepairs() times, feeding the previous
 *  error back as feedback. Returns the final result with the repair count. */
export async function repairLoop(
  attempt: (feedback?: string) => Promise<DryRunResult>,
): Promise<DryRunResult> {
  let res = await attempt();
  let n = 0;
  while (!res.ran && n < maxRepairs()) {
    n++;
    res = await attempt(res.error);
  }
  return { ...res, repairs: n };
}
