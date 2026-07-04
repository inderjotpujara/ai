import { dryRunMs } from './config.ts';
import type { CapabilitySignature, DryRunResult } from './types.ts';
import { ArtifactKind } from './types.ts';

/** Race `fn` against a wall clock; on timeout reject with 'dry-run timeout'. */
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

export type DryRunDeps = {
  runAgent: (task: string) => Promise<{ text: string } | { error: string }>;
  runCrew: (
    input: unknown,
  ) => Promise<{ kind: string; output?: unknown; message?: string }>;
  runWorkflow: (
    input: unknown,
  ) => Promise<{ kind: string; output?: unknown; message?: string }>;
};

export async function dryRun(
  kind: ArtifactKind,
  task: string,
  deps: DryRunDeps,
): Promise<DryRunResult> {
  try {
    if (kind === ArtifactKind.Agent) {
      const res = await withWallClock(dryRunMs(), () => deps.runAgent(task));
      if ('text' in res) return { ran: true, output: res.text, repairs: 0 };
      return { ran: false, error: res.error, repairs: 0 };
    }
    const run = kind === ArtifactKind.Crew ? deps.runCrew : deps.runWorkflow;
    const res = await withWallClock(dryRunMs(), () => run(task));
    if (res.kind === 'done') {
      return { ran: true, output: String(res.output), repairs: 0 };
    }
    return { ran: false, error: res.message ?? res.kind, repairs: 0 };
  } catch (err) {
    return { ran: false, error: String(err), repairs: 0 };
  }
}
