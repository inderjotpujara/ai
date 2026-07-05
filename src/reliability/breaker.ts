import {
  breakerCooldownMs,
  breakerHalfOpenProbes,
  breakerThreshold,
} from './config.ts';
import { CircuitOpenError } from './errors.ts';

export enum BreakerState {
  Closed = 'Closed',
  Open = 'Open',
  HalfOpen = 'HalfOpen',
}

export type BreakerOpts = {
  threshold?: number;
  cooldownMs?: number;
  halfOpenProbes?: number;
  now?: () => number;
};

/**
 * Closed → (≥threshold consecutive failures) → Open →
 * (after cooldownMs) → HalfOpen → (halfOpenProbes successes) → Closed
 *                                → (any failure) → Open
 * Cooldown is checked lazily on run() — no timers.
 */
export class CircuitBreaker {
  private failures = 0;
  private probeSuccesses = 0;
  private openedAt = 0;
  private current = BreakerState.Closed;
  private readonly threshold: number;
  private readonly cooldownMs: number;
  private readonly halfOpenProbes: number;
  private readonly now: () => number;

  constructor(
    readonly id: string,
    opts: BreakerOpts = {},
  ) {
    this.threshold = opts.threshold ?? breakerThreshold();
    this.cooldownMs = opts.cooldownMs ?? breakerCooldownMs();
    this.halfOpenProbes = opts.halfOpenProbes ?? breakerHalfOpenProbes();
    this.now = opts.now ?? (() => Date.now());
  }

  state(): BreakerState {
    if (
      this.current === BreakerState.Open &&
      this.now() - this.openedAt >= this.cooldownMs
    ) {
      this.current = BreakerState.HalfOpen;
      this.probeSuccesses = 0;
    }
    return this.current;
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state() === BreakerState.Open) {
      throw new CircuitOpenError(this.id);
    }
    try {
      const r = await fn();
      this.onSuccess();
      return r;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  private onSuccess(): void {
    if (this.current === BreakerState.HalfOpen) {
      this.probeSuccesses++;
      if (this.probeSuccesses >= this.halfOpenProbes) {
        this.current = BreakerState.Closed;
        this.failures = 0;
      }
      return;
    }
    this.failures = 0;
  }

  private onFailure(): void {
    if (this.current === BreakerState.HalfOpen) {
      this.trip();
      return;
    }
    this.failures++;
    if (this.failures >= this.threshold) this.trip();
  }

  private trip(): void {
    this.current = BreakerState.Open;
    this.openedAt = this.now();
  }
}

const registry = new Map<string, CircuitBreaker>();

/** Shared breaker for a dependency id (mcp:<name> / tool:<name> / runtime:<kind>). */
export function breakerFor(id: string, opts?: BreakerOpts): CircuitBreaker {
  let b = registry.get(id);
  if (!b) {
    b = new CircuitBreaker(id, opts);
    registry.set(id, b);
  }
  return b;
}

/** Test seam: clear the shared registry. */
export function resetBreakers(): void {
  registry.clear();
}
