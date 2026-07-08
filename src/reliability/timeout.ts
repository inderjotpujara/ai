/** Hard wall-clock cap (run_timeout). Rejects Error('timeout') on expiry.
 *  `fn` receives an `AbortSignal` that fires on timeout OR when the optional
 *  `external` signal aborts, so the underlying work (generateText, a
 *  subprocess, ...) can actually stop instead of leaking in the background. */
export function withWallClock<T>(
  ms: number,
  fn: (signal: AbortSignal) => Promise<T>,
  external?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  const onExt = () => controller.abort();
  if (external) {
    if (external.aborted) controller.abort();
    else external.addEventListener('abort', onExt, { once: true });
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const clock = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      // Reject the clock BEFORE aborting: abort() synchronously fires the
      // work's own abort listener (which typically rejects `fn`'s promise
      // too), and Promise.race adopts whichever underlying promise settles
      // (i.e. whose reject/resolve is called) first. Rejecting the clock
      // first makes the race settle with Error('timeout') rather than
      // whatever error the aborted work happens to reject with.
      reject(new Error('timeout'));
      controller.abort();
    }, ms);
  });
  return Promise.race([fn(controller.signal), clock]).finally(() => {
    clearTimeout(timer);
    if (external) external.removeEventListener('abort', onExt);
  });
}

/** Fires onIdle when a monotonic progress counter hasn't advanced within timeoutMs. */
export class IdleWatchdog {
  private lastProgress = -1;
  private lastAdvanceAt: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  constructor(
    private readonly timeoutMs: number,
    private readonly onIdle: () => void,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.lastAdvanceAt = now();
  }
  beat(progress: number): void {
    if (progress > this.lastProgress) {
      this.lastProgress = progress;
      this.lastAdvanceAt = this.now();
    }
  }
  tick(): void {
    if (this.now() - this.lastAdvanceAt >= this.timeoutMs) {
      this.onIdle();
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

/** Run a progress-bearing op with an idle timeout; `beat(progress)` resets the timer. */
export async function withIdleTimeout<T>(
  fn: (beat: (progress: number) => void) => Promise<T>,
  opts: { idleMs: number; onIdle: () => void; intervalMs?: number },
): Promise<T> {
  const w = new IdleWatchdog(opts.idleMs, opts.onIdle);
  w.beat(0);
  w.start(opts.intervalMs ?? 1000);
  try {
    return await fn((p) => w.beat(p));
  } finally {
    w.stop();
  }
}
