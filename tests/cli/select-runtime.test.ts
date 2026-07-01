import { describe, expect, it } from 'bun:test';
import { createSelectionRuntime } from '../../src/cli/select-runtime.ts';

describe('createSelectionRuntime', () => {
  it('returns a select hook + capture + close', async () => {
    const rt = await createSelectionRuntime();
    expect(typeof rt.onBeforeDelegate).toBe('function');
    expect(rt.capture).toBeDefined();
    await rt.close();
  });
});
