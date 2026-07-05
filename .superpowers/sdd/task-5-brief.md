### Task 5: Timeouts — withWallClock + IdleWatchdog + withIdleTimeout

**Files:**
- Create: `src/reliability/timeout.ts`
- Test: `tests/reliability/timeout.test.ts`

**Interfaces:**
- Produces:
  - `withWallClock<T>(ms: number, fn: () => Promise<T>): Promise<T>` (rejects `Error('timeout')` on expiry; clears its timer)
  - `class IdleWatchdog` — generalized `StallWatchdog`: `constructor(timeoutMs, onIdle, now?)`, `beat(progress: number)`, `tick()`, `start(intervalMs)`, `stop()`
  - `withIdleTimeout<T>(fn: (beat: (progress: number) => void) => Promise<T>, opts: { idleMs: number; onIdle: () => void; intervalMs?: number }): Promise<T>`

- [ ] **Step 1: Write the failing test**

```ts
// tests/reliability/timeout.test.ts
import { describe, expect, it } from 'bun:test';
import { IdleWatchdog, withIdleTimeout, withWallClock } from '../../src/reliability/timeout.ts';

describe('withWallClock', () => {
  it('resolves the fn result when it finishes in time', async () => {
    const r = await withWallClock(1000, async () => 42);
    expect(r).toBe(42);
  });
  it('rejects with a timeout when the fn is too slow', async () => {
    await expect(
      withWallClock(10, () => new Promise((r) => setTimeout(() => r('late'), 1000))),
    ).rejects.toThrow('timeout');
  });
});

describe('IdleWatchdog', () => {
  it('fires onIdle only after the timeout with no progress', () => {
    let fired = 0;
    let clock = 0;
    const w = new IdleWatchdog(100, () => fired++, () => clock);
    w.beat(0); // start tracking at time 0 (no advance yet)
    clock = 50;
    w.tick();
    expect(fired).toBe(0);
    clock = 150;
    w.tick();
    expect(fired).toBe(1);
  });
  it('resets the idle timer on progress', () => {
    let fired = 0;
    let clock = 0;
    const w = new IdleWatchdog(100, () => fired++, () => clock);
    w.beat(0);
    clock = 90;
    w.beat(10); // progress → resets
    clock = 150;
    w.tick(); // only 60ms since last progress
    expect(fired).toBe(0);
  });
});

describe('withIdleTimeout', () => {
  it('passes a beat fn and returns the result', async () => {
    const r = await withIdleTimeout(
      async (beat) => {
        beat(1);
        beat(2);
        return 'done';
      },
      { idleMs: 10_000, onIdle: () => {}, intervalMs: 1000 },
    );
    expect(r).toBe('done');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/reliability/timeout.test.ts`
Expected: FAIL — cannot resolve `timeout.ts`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/reliability/timeout.ts
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
  private timer: ReturnType<typeof setInterval> | null = null;
  private idleSince: number | null = null;
  constructor(
    private readonly timeoutMs: number,
    private readonly onIdle: () => void,
    private readonly now: () => number = () => Date.now(),
  ) {}
  beat(progress: number): void {
    if (progress > this.lastProgress) {
      this.lastProgress = progress;
      this.idleSince = null;
    } else if (this.idleSince === null) {
      this.idleSince = this.now();
    }
  }
  tick(): void {
    if (this.idleSince !== null && this.now() - this.idleSince >= this.timeoutMs) {
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/reliability/timeout.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Typecheck, lint, commit**

```bash
bun run typecheck && bun run lint:file -- "src/reliability/timeout.ts" "tests/reliability/timeout.test.ts"
git add src/reliability/timeout.ts tests/reliability/timeout.test.ts
git commit -m "feat(reliability): withWallClock + IdleWatchdog + withIdleTimeout"
```

---

