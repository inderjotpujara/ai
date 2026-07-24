import { expect, test } from 'bun:test';
import {
  JobKindWire,
  JobPriorityWire,
  JobStatusWire,
} from '../../src/contracts/enums.ts';
import { JobKind, JobPriority, JobStatus } from '../../src/queue/types.ts';

// The wire enums (`src/contracts/enums.ts`) MUST hold the same string values as
// their engine counterparts in `src/queue/types.ts` (Task 4). We compare the
// underlying string values (not the nominal enum arrays, which bun's `toEqual`
// rejects across two distinct string enums) so a future value drift breaks the
// build — same guard intent as `runtime-kind-parity.test.ts`. Slice 24.
const values = (e: Record<string, string>): string[] => Object.values(e).sort();

test('contract JobKind values stay isomorphic with queue', () => {
  expect(values(JobKindWire)).toEqual(values(JobKind));
});

test('JobKind gains Eval (Slice 32)', () => {
  expect(JobKind.Eval as string).toBe('eval');
  expect(JobKindWire.Eval as string).toBe('eval');
});

test('contract JobStatus values stay isomorphic with queue', () => {
  expect(values(JobStatusWire)).toEqual(values(JobStatus));
});

test('contract JobPriority values stay isomorphic with queue', () => {
  expect(values(JobPriorityWire)).toEqual(values(JobPriority));
});
