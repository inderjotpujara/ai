import { expect, test } from 'bun:test';
import qwenVision from '../../models/qwen-vision.ts';
import { BOOTSTRAP } from '../../models/registry.ts';
import { Capability } from '../../src/core/types.ts';

test('vision model advertises Vision and is in BOOTSTRAP', () => {
  expect(qwenVision.model).toBe('qwen2.5vl:7b');
  expect(qwenVision.capabilities).toContain(Capability.Vision);
  expect(BOOTSTRAP).toContain(qwenVision);
});
