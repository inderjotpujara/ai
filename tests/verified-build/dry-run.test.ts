import { describe, expect, test } from 'bun:test';
import {
  representativeTask,
  withWallClock,
} from '../../src/verified-build/dry-run.ts';
import type { CapabilitySignature } from '../../src/verified-build/types.ts';

const sig: CapabilitySignature = {
  purpose: 'summarize urls',
  tools: [],
  modelTier: '',
  io: '',
  roles: [],
};

describe('withWallClock', () => {
  test('rejects with dry-run timeout when fn never settles', async () => {
    await expect(
      withWallClock(10, () => new Promise<never>(() => {})),
    ).rejects.toThrow('dry-run timeout');
  });

  test('resolves with the fn value when it finishes in time', async () => {
    await expect(withWallClock(1000, async () => 'fast')).resolves.toBe('fast');
  });
});

describe('representativeTask', () => {
  test('is a benign read-only phrasing derived from the purpose', () => {
    const task = representativeTask('summarize urls', sig);
    expect(task).toContain('summarize urls');
    expect(task.toLowerCase()).toContain('read-only');
  });

  test('falls back to the need when purpose is empty', () => {
    const task = representativeTask('route tickets', { ...sig, purpose: '' });
    expect(task).toContain('route tickets');
  });
});
