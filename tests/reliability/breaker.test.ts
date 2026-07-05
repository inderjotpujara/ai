import { beforeEach, describe, expect, it } from 'bun:test';
import {
  BreakerState,
  breakerFor,
  CircuitBreaker,
  resetBreakers,
} from '../../src/reliability/breaker.ts';
import { CircuitOpenError } from '../../src/reliability/errors.ts';

const fail = () => Promise.reject(new Error('boom'));
const ok = () => Promise.resolve('ok');

describe('CircuitBreaker', () => {
  it('opens after threshold consecutive failures', async () => {
    const b = new CircuitBreaker('t', { threshold: 3, cooldownMs: 1000 });
    for (let i = 0; i < 3; i++) await b.run(fail).catch(() => {});
    expect(b.state()).toBe(BreakerState.Open);
    await expect(b.run(ok)).rejects.toBeInstanceOf(CircuitOpenError);
  });

  it('half-opens after cooldown and closes on a successful probe', async () => {
    let clock = 0;
    const b = new CircuitBreaker('t', {
      threshold: 1,
      cooldownMs: 100,
      halfOpenProbes: 1,
      now: () => clock,
    });
    await b.run(fail).catch(() => {});
    expect(b.state()).toBe(BreakerState.Open);
    clock = 150; // past cooldown
    const r = await b.run(ok); // half-open probe succeeds → close
    expect(r).toBe('ok');
    expect(b.state()).toBe(BreakerState.Closed);
  });

  it('a success resets the consecutive-failure count', async () => {
    const b = new CircuitBreaker('t', { threshold: 3, cooldownMs: 1000 });
    await b.run(fail).catch(() => {});
    await b.run(fail).catch(() => {});
    await b.run(ok);
    await b.run(fail).catch(() => {});
    expect(b.state()).toBe(BreakerState.Closed); // count reset by the success
  });
});

describe('breakerFor registry', () => {
  beforeEach(() => resetBreakers());
  it('returns the same breaker for the same id', () => {
    expect(breakerFor('mcp:a')).toBe(breakerFor('mcp:a'));
    expect(breakerFor('mcp:a')).not.toBe(breakerFor('mcp:b'));
  });
});
