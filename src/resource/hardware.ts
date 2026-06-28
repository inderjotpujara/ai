import os from 'node:os';

/**
 * Apple Silicon caps the Metal GPU working set at ~75% of unified memory.
 * That fraction — not os.freemem() (unreliable on macOS) — is the real ceiling
 * for accelerated inference.
 */
export const GPU_BUDGET_FRACTION = 0.75;

/** GPU-usable bytes for a given total-RAM figure. */
export function gpuBudgetBytes(totalRamBytes: number): number {
  return Math.floor(totalRamBytes * GPU_BUDGET_FRACTION);
}

/** GPU-usable bytes for the current machine. */
export function machineBudgetBytes(): number {
  return gpuBudgetBytes(os.totalmem());
}

/** Does a model of `modelBytes` fit within `budgetBytes`? */
export function fitsBudget(modelBytes: number, budgetBytes: number): boolean {
  return modelBytes <= budgetBytes;
}
