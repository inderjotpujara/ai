import { beforeEach, expect, test } from 'bun:test';
import {
  childCount,
  killAllChildren,
  registerChild,
} from '../../src/process/child-registry.ts';

// The registry is a process-global singleton; other suites that spawn can
// leave entries in the shared set. Reset before each test so absolute counts
// are deterministic regardless of file execution order.
beforeEach(() => killAllChildren());

test('killAllChildren kills every registered child and respects unregister', () => {
  const killed: string[] = [];
  const off1 = registerChild({ kill: () => killed.push('a') });
  const off2 = registerChild({ kill: () => killed.push('b') });
  expect(childCount()).toBe(2);
  off2(); // 'b' exited on its own
  killAllChildren('SIGTERM');
  expect(killed).toEqual(['a']); // only the still-live child is killed
  off1();
  expect(childCount()).toBe(0);
});
