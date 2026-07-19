import { expect, test } from 'bun:test';
import { RunKind } from '../../src/contracts/enums.ts';
import { JobKind, JobPriority, JobStatus } from '../../src/queue/types.ts';

test('JobStatus has the six lifecycle states', () => {
  expect((Object.values(JobStatus) as string[]).sort()).toEqual(
    ['canceled', 'done', 'failed', 'interrupted', 'queued', 'running'].sort(),
  );
});

test('JobPriority has two lanes', () => {
  expect(Object.values(JobPriority) as string[]).toEqual(['high', 'normal']);
});

test('every JobKind value is a valid RunKind value (subset invariant)', () => {
  const runKinds = new Set<string>(Object.values(RunKind));
  for (const k of Object.values(JobKind)) {
    expect(runKinds.has(k)).toBe(true);
  }
});
