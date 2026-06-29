import { expect, test } from 'bun:test';
import { BOOTSTRAP } from '../../models/registry.ts';
import { Capability } from '../../src/core/types.ts';

test('registry contains the two verified rungs, both tool-capable', () => {
  const names = BOOTSTRAP.map((d) => d.model).sort();
  expect(names).toEqual(['qwen3.5:4b', 'qwen3.5:9b']);
  for (const d of BOOTSTRAP) {
    expect(d.capabilities ?? []).toContain(Capability.Tools);
  }
});

test('registry has a real capability ladder (distinct sizes)', () => {
  const sizes = BOOTSTRAP.map((d) => d.footprint.approxParamsBillions);
  expect(new Set(sizes).size).toBe(BOOTSTRAP.length);
});
