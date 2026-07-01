import { afterEach, describe, expect, test } from 'bun:test';
import { retrievalBudgetChars, retrievalCtxFraction } from '../../src/memory/budget.ts';

afterEach(() => { delete process.env.AGENT_MEMORY_CTX_FRACTION; });

describe('retrieval budget', () => {
  test('scales with num_ctx (fraction × ctx × 4 chars/token)', () => {
    expect(retrievalBudgetChars(16384)).toBe(Math.floor(0.25 * 16384 * 4));
  });
  test('falls back to 4096 when ctx unknown', () => {
    expect(retrievalBudgetChars(undefined)).toBe(Math.floor(0.25 * 4096 * 4));
  });
  test('honors AGENT_MEMORY_CTX_FRACTION', () => {
    process.env.AGENT_MEMORY_CTX_FRACTION = '0.5';
    expect(retrievalCtxFraction()).toBe(0.5);
    expect(retrievalBudgetChars(8192)).toBe(Math.floor(0.5 * 8192 * 4));
  });
  test('ignores out-of-range fraction', () => {
    process.env.AGENT_MEMORY_CTX_FRACTION = '3';
    expect(retrievalCtxFraction()).toBe(0.25);
  });
});
