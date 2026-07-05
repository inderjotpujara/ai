import { retryBaseMs, retryCapMs } from './config.ts';

/** Shared download retry shape (was duplicated in ollama.ts + hf-fetch.ts). */
export function defaultDownloadRetry(): {
  attempts: number;
  baseMs: number;
  capMs: number;
  jitter: () => number;
} {
  return {
    attempts: Number(process.env.AGENT_DOWNLOAD_ATTEMPTS) || 6,
    baseMs: retryBaseMs(),
    capMs: retryCapMs(),
    jitter: () => 0.5 + Math.random() / 2,
  };
}

/** Idle/stall timeout for a download with no byte progress. */
export function downloadStallMs(): number {
  return Number(process.env.AGENT_DOWNLOAD_STALL_MS) || 90_000;
}
