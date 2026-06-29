import { execFile } from 'node:child_process';
import os from 'node:os';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * Apple Silicon caps the Metal GPU working set at ~75% of unified memory.
 * That fraction is the hardware ceiling for accelerated inference, regardless
 * of how much RAM is free right now.
 */
export const GPU_BUDGET_FRACTION = 0.75;

/**
 * Ollama refuses to co-load a model when its predicted size exceeds ~80% of
 * *free* system RAM (sched.go, `system_limited`). So the real, moment-to-moment
 * ceiling is this fraction of whatever is actually available — far smaller than
 * the Metal cap on a loaded machine.
 */
export const FREE_BUDGET_FRACTION = 0.8;

/** A fraction env override, used only as a fallback to the constants above. */
function envFraction(name: string, fallback: number): number {
  const raw = process.env[name];
  const n = raw === undefined ? Number.NaN : Number(raw);
  return Number.isFinite(n) && n > 0 && n <= 1 ? n : fallback;
}

/** GPU-usable bytes for a given total-RAM figure (the static Metal cap). */
export function gpuBudgetBytes(totalRamBytes: number): number {
  return Math.floor(
    totalRamBytes *
      envFraction('AGENT_GPU_BUDGET_FRACTION', GPU_BUDGET_FRACTION),
  );
}

/** Static Metal-cap budget for the current machine (fallback, not live-aware). */
export function machineBudgetBytes(): number {
  return gpuBudgetBytes(os.totalmem());
}

/**
 * Live free/available system RAM in bytes, computed on the fly.
 *
 * `os.freemem()` on macOS counts only truly-free pages and wildly understates
 * what is reclaimable, so we parse `vm_stat`: free + inactive + speculative +
 * purgeable pages are all available to a new allocation without swapping.
 * Falls back to `os.freemem()`, then to half of total RAM, if the probe fails.
 */
export async function availableRamBytes(): Promise<number> {
  try {
    const { stdout } = await run('vm_stat', [], { timeout: 1500 });
    // Apple Silicon page size is 16384, not the 4096 of older platforms.
    const pageSize = Number(
      stdout.match(/page size of (\d+) bytes/)?.[1] ?? 16384,
    );
    const pages = (label: string): number =>
      Number(stdout.match(new RegExp(`${label}:\\s+(\\d+)\\.`))?.[1] ?? 0);
    const reclaimablePages =
      pages('Pages free') +
      pages('Pages inactive') +
      pages('Pages speculative') +
      pages('Pages purgeable');
    if (reclaimablePages > 0 && pageSize > 0) {
      return reclaimablePages * pageSize;
    }
  } catch {
    // vm_stat unavailable (non-macOS or sandboxed) — fall through to fallbacks.
  }
  const free = os.freemem();
  return free > 0 ? free : Math.floor(os.totalmem() * 0.5);
}

/**
 * The real budget right now: the smaller of the static Metal cap and the live
 * free-RAM gate. Recomputed on demand so it tracks memory pressure instead of
 * trusting a figure frozen at process start.
 */
export async function liveBudgetBytes(): Promise<number> {
  const metalCap = machineBudgetBytes();
  const available = await availableRamBytes();
  const freeCap = Math.floor(
    available * envFraction('AGENT_FREE_BUDGET_FRACTION', FREE_BUDGET_FRACTION),
  );
  return Math.min(metalCap, freeCap);
}

/** Does a model of `modelBytes` fit within `budgetBytes`? */
export function fitsBudget(modelBytes: number, budgetBytes: number): boolean {
  return modelBytes <= budgetBytes;
}
