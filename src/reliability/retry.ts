import { classify, Lane } from './classify.ts';
import { maxAttempts, retryBaseMs, retryCapMs } from './config.ts';

/** Sleep for `ms`, resolving early if `signal` is (or becomes) aborted. */
export function abortableSleep(
  ms: number,
  signal?: AbortSignal,
): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  if (!signal) return new Promise((r) => setTimeout(r, ms));
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/** Extract a Retry-After delay (ms) from an error's response headers, if present. */
export function parseRetryAfter(err: unknown): number | undefined {
  const headers = (err as { responseHeaders?: Record<string, string> })
    ?.responseHeaders;
  const raw = headers?.['retry-after'] ?? headers?.['Retry-After'];
  if (!raw) return undefined;
  const secs = Number(raw);
  return Number.isFinite(secs) && secs >= 0 ? secs * 1000 : undefined;
}

export type RetryOpts = {
  attempts?: number;
  baseMs?: number;
  capMs?: number;
  jitter?: () => number;
  onRetry?: (n: number) => void;
  signal?: AbortSignal;
  /** Override the default (classify → Transient) retryability test. */
  retryable?: (err: unknown) => boolean;
};

/**
 * Full-jitter exponential backoff retry for cross-boundary ops WE own
 * (MCP calls, downloads, probes, direct HTTP). By default retries only the
 * Transient lane. NEVER wrap an LLM generateText turn in this (see spec D5).
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOpts = {},
): Promise<T> {
  const attempts = Math.max(1, opts.attempts ?? maxAttempts());
  const baseMs = opts.baseMs ?? retryBaseMs();
  const capMs = opts.capMs ?? retryCapMs();
  const jitter = opts.jitter ?? (() => 0.5 + Math.random() / 2);
  const retryable =
    opts.retryable ?? ((e: unknown) => classify(e) === Lane.Transient);

  let lastErr: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0 && opts.signal?.aborted) break;
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!retryable(err)) throw err;
      const next = attempt + 1;
      if (next >= attempts) break;
      if (opts.signal?.aborted) break;
      opts.onRetry?.(next);
      const backoff = Math.min(capMs, baseMs * 2 ** attempt);
      const retryAfter = parseRetryAfter(err);
      const delay = retryAfter ?? Math.floor(jitter() * backoff);
      await abortableSleep(delay, opts.signal);
    }
  }
  throw lastErr;
}
