import { describe, expect, test } from 'bun:test';
import { newRunId } from '../../src/run/run-id.ts';

describe('newRunId', () => {
  test('is unique across rapid calls in one process', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => newRunId()));
    expect(ids.size).toBe(1000);
  });
  test('is chronologically sortable by string compare', () => {
    const a = newRunId(1_000_000, () => 0.1);
    const b = newRunId(2_000_000, () => 0.1);
    expect(a < b).toBe(true);
  });
  test('has the run- prefix', () => {
    expect(newRunId()).toMatch(/^run-[0-9a-z]+-[0-9a-z]+$/);
  });
});
