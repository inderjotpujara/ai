import { totalmem } from 'node:os';
import type { HostCapabilities } from './catalog-source.ts';
import { liveBudgetBytes } from '../resource/hardware.ts';
import { availableRuntimes } from '../runtime/registry.ts';

/** Detect what this machine can run right now: RAM, live budget, reachable runtimes. */
export async function detectHost(): Promise<HostCapabilities> {
  const runtimes = (await availableRuntimes()).map((r) => r.kind);
  return { totalRamBytes: totalmem(), liveBudgetBytes: await liveBudgetBytes(), runtimes };
}
