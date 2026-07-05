import { afterEach, describe, expect, it } from 'bun:test';
import {
  breakerCooldownMs,
  breakerThreshold,
  idleTimeoutMs,
  maxAttempts,
  probeTimeoutMs,
  retryBaseMs,
  retryCapMs,
  runTimeoutMs,
} from '../../src/reliability/config.ts';

describe('reliability config', () => {
  const keys = [
    'AGENT_MAX_ATTEMPTS',
    'AGENT_RUN_TIMEOUT_MS',
    'AGENT_IDLE_TIMEOUT_MS',
    'AGENT_BREAKER_THRESHOLD',
    'AGENT_BREAKER_COOLDOWN_MS',
    'AGENT_RETRY_BASE_MS',
    'AGENT_RETRY_CAP_MS',
    'AGENT_PROBE_TIMEOUT_MS',
  ];
  afterEach(() => {
    for (const k of keys) delete process.env[k];
  });

  it('returns sensible positive defaults', () => {
    expect(maxAttempts()).toBeGreaterThan(0);
    expect(runTimeoutMs()).toBeGreaterThan(0);
    expect(idleTimeoutMs()).toBeGreaterThan(0);
    expect(breakerThreshold()).toBeGreaterThan(0);
    expect(breakerCooldownMs()).toBeGreaterThan(0);
    expect(retryBaseMs()).toBeGreaterThan(0);
    expect(retryCapMs()).toBeGreaterThanOrEqual(retryBaseMs());
    expect(probeTimeoutMs()).toBeGreaterThan(0);
  });

  it('env vars override defaults', () => {
    process.env.AGENT_MAX_ATTEMPTS = '7';
    process.env.AGENT_BREAKER_THRESHOLD = '3';
    expect(maxAttempts()).toBe(7);
    expect(breakerThreshold()).toBe(3);
  });

  it('ignores non-numeric / zero env and uses the fallback', () => {
    process.env.AGENT_MAX_ATTEMPTS = 'nope';
    expect(maxAttempts()).toBeGreaterThan(0);
  });
});
