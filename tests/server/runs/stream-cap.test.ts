import { expect, test } from 'bun:test';
import {
  acquireStreamSlot,
  openStreamCount,
  releaseStreamSlot,
} from '../../../src/server/runs/stream-limit.ts';

test('acquire succeeds up to the cap, then refuses; release frees a slot', () => {
  const cap = 2;
  expect(acquireStreamSlot(cap)).toBe(true);
  expect(acquireStreamSlot(cap)).toBe(true);
  expect(acquireStreamSlot(cap)).toBe(false); // cap+1 refused
  expect(openStreamCount()).toBe(2);
  releaseStreamSlot();
  expect(acquireStreamSlot(cap)).toBe(true); // slot freed
  releaseStreamSlot();
  releaseStreamSlot();
  expect(openStreamCount()).toBe(0);
});
