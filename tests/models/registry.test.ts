import { expect, test } from 'bun:test';
import { REGISTRY } from '../../models/registry.ts';
import { Capability } from '../../src/core/types.ts';

test('registry contains the two verified rungs, both tool-capable', () => {
  const names = REGISTRY.map((d) => d.model).sort();
  expect(names).toEqual(['qwen3.5:4b', 'qwen3.5:9b']);
  for (const d of REGISTRY) {
    expect(d.capabilities ?? []).toContain(Capability.Tools);
  }
});

test('registry has a real capability ladder (distinct sizes)', () => {
  const sizes = REGISTRY.map((d) => d.footprint.approxParamsBillions);
  expect(new Set(sizes).size).toBe(REGISTRY.length);
});
