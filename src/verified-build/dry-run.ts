import type { CapabilitySignature } from './types.ts';

/** Race `fn` against a wall clock; on timeout reject with 'dry-run timeout'.
 *  The builders' gate closures apply this (with `dryRunMs()`) around every
 *  dry-run / golden-eval model call so a hung model can never hang the build
 *  (C1). The agent path additionally threads an `AbortSignal.timeout` down to
 *  `generateText`; crew/workflow runs are bounded by this wall-clock race
 *  alone (runCrew/runWorkflow take no signal yet). */
export function withWallClock<T>(ms: number, fn: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const clock = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('dry-run timeout')), ms);
  });
  return Promise.race([fn(), clock]).finally(() => clearTimeout(timer));
}

/** A benign, read-only task derived from the need — safe to run unattended. */
export function representativeTask(
  need: string,
  sig: CapabilitySignature,
): string {
  const goal = sig.purpose || need;
  return `Read-only smoke check: ${goal}. Do not modify, create, or delete anything — just inspect and report a short summary.`;
}
