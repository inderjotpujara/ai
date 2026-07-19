import { expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCheckpointStore } from '../../src/workflow/checkpoint.ts';

test('a recorded node is skipped on resume with its result available', () => {
  const dir = mkdtempSync(join(tmpdir(), 'run-'));
  const s1 = createCheckpointStore(dir);
  s1.record('a', { out: 1 });
  s1.record('b', { out: 2 });
  const s2 = createCheckpointStore(dir); // "resume" — fresh store, same dir
  expect(s2.completed()).toEqual(new Set(['a', 'b']));
  expect(s2.resultOf('a')).toEqual({ out: 1 });
  expect(s2.completed().has('c')).toBe(false);
});

test('double-record of the same node is idempotent (no duplicate marker)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'run-'));
  const s = createCheckpointStore(dir);
  s.record('a', { v: 1 });
  s.record('a', { v: 2 }); // re-record — last write wins on result, set stays {a}
  const resumed = createCheckpointStore(dir);
  expect(resumed.completed()).toEqual(new Set(['a']));
  expect(resumed.resultOf('a')).toEqual({ v: 2 });
});

test('a fresh run dir has no completed nodes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'run-'));
  const s = createCheckpointStore(dir);
  expect(s.completed()).toEqual(new Set());
  expect(s.resultOf('anything')).toBeUndefined();
});
