import { afterEach, describe, expect, test } from 'bun:test';
import {
  autoPullPolicy,
  verifyMaxRetries,
  verifyModel,
  verifyThreshold,
} from '../../src/verification/config.ts';

afterEach(() => {
  for (const k of [
    'AGENT_VERIFY_MODEL',
    'AGENT_VERIFY_THRESHOLD',
    'AGENT_VERIFY_MAX_RETRIES',
    'AGENT_VERIFY_AUTO_PULL',
  ])
    delete process.env[k];
});

describe('verification config', () => {
  test('defaults', () => {
    expect(verifyModel()).toBe('bespoke-minicheck');
    expect(verifyThreshold()).toBe(0.9);
    expect(verifyMaxRetries()).toBe(1);
    expect(autoPullPolicy()).toBe('prompt');
  });
  test('env overrides + range guards', () => {
    process.env.AGENT_VERIFY_MODEL = 'x';
    process.env.AGENT_VERIFY_THRESHOLD = '0.5';
    process.env.AGENT_VERIFY_MAX_RETRIES = '2';
    process.env.AGENT_VERIFY_AUTO_PULL = '1';
    expect(verifyModel()).toBe('x');
    expect(verifyThreshold()).toBe(0.5);
    expect(verifyMaxRetries()).toBe(2);
    expect(autoPullPolicy()).toBe('always');
  });
  test('out-of-range threshold falls back', () => {
    process.env.AGENT_VERIFY_THRESHOLD = '3';
    expect(verifyThreshold()).toBe(0.9);
  });
});
