import { expect, test } from 'bun:test';
import { createTaskIndex } from '../../src/a2a/task-index.ts';

// The task index caches taskId→jobId + contextId bindings. Identity is 1:1
// (taskId === jobId) and durable in the job store, so an evicted binding still
// resolves via that identity fallback — but a NON-identity binding + contextId
// is observably lost once evicted, which is how we prove the bound is enforced.

test('createTaskIndex resolves a bound task to its jobId + contextId', () => {
  const idx = createTaskIndex();
  idx.bind('task-1', 'job-1', 'ctx-1');
  expect(idx.jobIdForTask('task-1')).toBe('job-1');
  expect(idx.contextFor('task-1')).toBe('ctx-1');
  // An unbound task falls back to the durable identity (taskId === jobId) and to
  // itself as its own context.
  expect(idx.jobIdForTask('task-unbound')).toBe('task-unbound');
  expect(idx.contextFor('task-unbound')).toBe('task-unbound');
});

test('the task index is BOUNDED by a config knob (env-fallback): exceeding the cap evicts the OLDEST binding, never grows unbounded', () => {
  // Cap injected at 3 (the knob is env-fallback in production; overridable here
  // so eviction is testable without a huge loop).
  const idx = createTaskIndex(3);
  // Non-identity bindings so eviction is observable (jobId !== taskId, and a
  // distinct contextId that the identity fallback cannot reproduce).
  idx.bind('t1', 'j1', 'c1');
  idx.bind('t2', 'j2', 'c2');
  idx.bind('t3', 'j3', 'c3');
  // A 4th binding crosses the cap → the OLDEST ('t1') is evicted from BOTH maps.
  idx.bind('t4', 'j4', 'c4');

  // Evicted: resolves via the identity fallback (taskId itself), NOT 'j1'/'c1'.
  expect(idx.jobIdForTask('t1')).toBe('t1');
  expect(idx.contextFor('t1')).toBe('t1');
  // Still retained: the three most-recent bindings resolve to their real values.
  expect(idx.jobIdForTask('t2')).toBe('j2');
  expect(idx.contextFor('t2')).toBe('c2');
  expect(idx.jobIdForTask('t4')).toBe('j4');
  expect(idx.contextFor('t4')).toBe('c4');
});

test('re-binding an existing taskId does not double-count toward the cap', () => {
  const idx = createTaskIndex(2);
  idx.bind('t1', 'j1', 'c1');
  idx.bind('t2', 'j2', 'c2');
  // Re-bind t1 (update, not a new key) — must not evict t2.
  idx.bind('t1', 'j1b', 'c1b');
  expect(idx.jobIdForTask('t1')).toBe('j1b');
  expect(idx.jobIdForTask('t2')).toBe('j2');
});
