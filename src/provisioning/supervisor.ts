export type PreflightInput = {
  requiredBytes: number;
  freeBytes: number;
  headroomBytes?: number;
};

const DEFAULT_HEADROOM = 2 * 1024 ** 3; // 2 GB slack over the sum of downloads

/** Disk-space preflight: Ollama does not do this and fails mid-download. */
export function checkDiskSpace(i: PreflightInput): {
  ok: boolean;
  shortfallBytes: number;
} {
  const need = i.requiredBytes + (i.headroomBytes ?? DEFAULT_HEADROOM);
  const shortfall = need - i.freeBytes;
  return { ok: shortfall <= 0, shortfallBytes: Math.max(0, shortfall) };
}

export { abortableSleep, withRetry } from '../reliability/retry.ts';
export { IdleWatchdog as StallWatchdog } from '../reliability/timeout.ts';
