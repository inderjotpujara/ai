/** Hard wall-clock cap (run_timeout). Rejects Error('timeout') on expiry. */
export function withWallClock<T>(ms: number, fn: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const clock = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), ms);
  });
  return Promise.race([fn(), clock]).finally(() => clearTimeout(timer));
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
