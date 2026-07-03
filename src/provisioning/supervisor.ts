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

/** Sleep for `ms`, resolving early if `signal` is (or becomes) aborted. */
function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  if (!signal) return new Promise((r) => setTimeout(r, ms));
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
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

/** Full-jitter exponential backoff retry. Idempotent re-invocation is the retry primitive. */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: {
    attempts: number;
    baseMs: number;
    capMs: number;
    jitter: () => number;
    onRetry?: (n: number) => void;
    signal?: AbortSignal;
  },
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < opts.attempts; attempt++) {
    if (attempt > 0 && opts.signal?.aborted) break;
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const next = attempt + 1;
      if (next >= opts.attempts) break;
      if (opts.signal?.aborted) break;
      opts.onRetry?.(next);
      const backoff = Math.min(opts.capMs, opts.baseMs * 2 ** attempt);
      const delay = Math.floor(opts.jitter() * backoff);
      await abortableSleep(delay, opts.signal);
    }
  }
  throw lastErr;
}

/** Aborts a download whose byte count hasn't advanced within `timeoutMs`. */
export class StallWatchdog {
  private lastBytes = -1;
  private timer: ReturnType<typeof setInterval> | null = null;
  private stalledSince: number | null = null;
  constructor(
    private readonly timeoutMs: number,
    private readonly onStall: () => void,
    private readonly now: () => number = () => Date.now(),
  ) {}
  beat(bytes: number): void {
    if (bytes > this.lastBytes) {
      this.lastBytes = bytes;
      this.stalledSince = null;
    } else if (this.stalledSince === null) {
      this.stalledSince = this.now();
    }
  }
  /** Call on a timer (or manually in tests); fires onStall past the timeout. */
  tick(): void {
    if (
      this.stalledSince !== null &&
      this.now() - this.stalledSince >= this.timeoutMs
    ) {
      this.onStall();
    }
  }
  start(intervalMs: number): void {
    this.timer = setInterval(() => this.tick(), intervalMs);
  }
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
